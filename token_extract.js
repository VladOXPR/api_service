// Use puppeteer-core for Vercel/serverless when Chromium path is provided; otherwise full puppeteer (local/dev).
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
let puppeteer;
try {
    if (isVercel || process.env.PUPPETEER_EXECUTABLE_PATH) {
        puppeteer = require('puppeteer-core');
    } else {
        puppeteer = require('puppeteer');
    }
} catch (e) {
    puppeteer = require('puppeteer');
}

// Cache for Chromium executable path to avoid repeated extraction
let cachedChromiumPath = null;

const path = require('path');

// Load environment variables for local development
// This ensures OPENAI_API_KEY, ENERGO_USERNAME, and ENERGO_PASSWORD are available when running locally
try {
    // Try loading .env from current directory first
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    // Also try .env.local if it exists (for backwards compatibility)
    require('dotenv').config({ path: path.join(__dirname, '.env.local') });
} catch (error) {
    // dotenv might not be available or .env files don't exist, that's okay
    // Environment variables will come from process.env (set by parent module or system)
}

// Add fetch for Node.js
let fetch;
if (typeof globalThis.fetch === 'undefined') {
    fetch = require('node-fetch');
} else {
    fetch = globalThis.fetch;
}

// ========================================
// CONFIGURATION
// ========================================
// OpenAI API key is loaded from OPENAI_API_KEY environment variable
// Set it in Vercel dashboard or .env.local for local development

// Browser preview mode
// Set to false to see the browser window, true to run in headless mode (no browser window)
const SHOW_BROWSER_PREVIEW = true;

const TOKEN_CAPTURE_TIMEOUT_MS = parseInt(process.env.TOKEN_CAPTURE_TIMEOUT_MS || '30000', 10);
const CAPTCHA_MAX_ATTEMPTS = parseInt(process.env.CAPTCHA_MAX_ATTEMPTS || '3', 10);
const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '2', 10);
const TOKEN_EXTRACT_DEBUG = process.env.TOKEN_EXTRACT_DEBUG === '1';

/** Single-flight promise: concurrent GET /token calls share one Puppeteer run. */
let extractionFlight = null;

/**
 * Helper function to wait/sleep (replacement for deprecated page.waitForTimeout)
 * @param {number} milliseconds - Time to wait in milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function redactToken(token) {
    if (!token || typeof token !== 'string') return '(none)';
    return token.length <= 12 ? `${token.slice(0, 4)}...` : `${token.slice(0, 12)}...`;
}

function logExtractionMetric(fields) {
    console.log(JSON.stringify({ event: 'token_extraction', ...fields }));
}

function extractionFailure(stage, error, { retriable = true, httpStatus = 500, extra = {} } = {}) {
    return {
        success: false,
        stage,
        error: error || stage,
        retriable,
        httpStatus,
        ...extra,
    };
}

function isExtractionInProgress() {
    return extractionFlight !== null;
}

function extractBearerFromHeaders(headers) {
    if (!headers) return null;
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.replace('Bearer ', '').trim();
    }
    return null;
}

/**
 * Attach request/response listeners to capture Bearer tokens from any Energo /api/ call.
 */
function setupBearerCapture(page) {
    let capturedToken = null;
    let captureSource = null;
    let tokenPromiseResolve = null;
    const tokenPromise = new Promise((resolve) => {
        tokenPromiseResolve = resolve;
    });

    const tryCapture = (token, source) => {
        if (token && !capturedToken) {
            capturedToken = token;
            captureSource = source;
            console.log(`Authorization token captured (${source}): ${redactToken(token)}`);
            if (tokenPromiseResolve) {
                tokenPromiseResolve(capturedToken);
                tokenPromiseResolve = null;
            }
        }
    };

    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
            const token = extractBearerFromHeaders(request.headers());
            if (token) tryCapture(token, 'request');
        }
    });

    page.on('response', (response) => {
        try {
            const url = response.url();
            if (url.includes('/api/')) {
                const token = extractBearerFromHeaders(response.request().headers());
                if (token) tryCapture(token, 'response');
            }
        } catch (_) {
            // ignore response header read errors
        }
    });

    return {
        getToken: () => capturedToken,
        getCaptureSource: () => captureSource,
        waitForToken: async (timeoutMs) => {
            if (capturedToken) return capturedToken;
            await Promise.race([
                tokenPromise.then(() => capturedToken),
                delay(timeoutMs).then(() => null),
            ]);
            return capturedToken;
        },
    };
}

async function saveDebugArtifacts(page, stage) {
    if (!TOKEN_EXTRACT_DEBUG || !page) return;
    try {
        const stamp = Date.now();
        const screenshotPath = `/tmp/token-extract-${stage}-${stamp}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Debug screenshot saved: ${screenshotPath}`);
    } catch (err) {
        console.warn('Could not save debug screenshot:', err.message);
    }
}

/**
 * Solve captcha using OpenAI Vision API
 * The captcha is a simple math problem in format: number operator number = ?
 * @param {string} imageBase64 - Base64 encoded image data (with or without data URL prefix)
 * @param {string} openaiApiKey - OpenAI API key
 * @returns {Promise<string>} - The numeric answer to the math problem
 */
async function solveCaptchaWithOpenAI(imageBase64, openaiApiKey) {
    try {
        // Remove data URL prefix if present
        const base64Data = imageBase64.includes(',') 
            ? imageBase64.split(',')[1] 
            : imageBase64;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o', // or 'gpt-4o-mini' for faster/cheaper
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'This is a captcha image showing a simple math problem. The format is: number operator number = ? (where operator can be +, -, *, or /). Solve the math problem and respond with ONLY the numeric answer (the number that should replace the ?). Do not include any explanation, spaces, or additional characters - just the number.'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/png;base64,${base64Data}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 10 // Math answers are usually short
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorData}`);
        }

        const data = await response.json();
        const captchaCode = data.choices[0].message.content.trim();
        
        console.log(`OpenAI solved captcha: ${captchaCode}`);
        return captchaCode;
    } catch (error) {
        console.error('Error solving captcha with OpenAI:', error);
        throw error;
    }
}

/**
 * Extract captcha image from the page
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<string>} - Base64 image data URL
 */
async function extractCaptchaImage(page) {
    console.log('Waiting for captcha image to load...');
    // Wait longer for the captcha image to load
    await delay(2000);

    // First, check all img elements for base64 data URLs (most reliable)
    try {
        const allImageData = await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img'));
            return images.map(img => ({
                src: img.src,
                id: img.id,
                className: img.className,
                alt: img.alt
            })).filter(imgData => imgData.src && imgData.src.startsWith('data:image'));
        });
        
        if (allImageData.length > 0) {
            // Get the last one (most recent, as user mentioned it's the last GET request)
            const lastImage = allImageData[allImageData.length - 1];
            console.log(`Found captcha image from page (last base64 image): ${lastImage.src.substring(0, 50)}...`);
            return lastImage.src;
        }
        console.log(`Found ${allImageData.length} base64 images, checking all images...`);
    } catch (e) {
        console.log('Error evaluating page for base64 images:', e.message);
    }

    // Try to find captcha image element with various selectors
    const imageSelectors = [
        'img[src*="captcha" i]',
        'img[id*="captcha" i]',
        'img[class*="captcha" i]',
        'img[alt*="captcha" i]',
        'img[src*="data:image"]',
        'img'
    ];

    let captchaImage = null;
    let imageSrc = null;

    for (const selector of imageSelectors) {
        try {
            const images = await page.$$(selector);
            console.log(`Checking ${images.length} images with selector: ${selector}`);
            for (const img of images) {
                const src = await page.evaluate(el => el.src, img);
                // Check if it's a base64 data URL or contains captcha
                if (src && (src.startsWith('data:image') || src.toLowerCase().includes('captcha'))) {
                    captchaImage = img;
                    imageSrc = src;
                    console.log(`Found captcha image element with selector: ${selector}`);
                    if (imageSrc.startsWith('data:image')) {
                        return imageSrc;
                    }
                    break;
                }
            }
            if (captchaImage && imageSrc && imageSrc.startsWith('data:image')) break;
        } catch (e) {
            console.log(`Error with selector ${selector}:`, e.message);
        }
    }

    // If we found an image with data URL, use it directly
    if (imageSrc && imageSrc.startsWith('data:image')) {
        return imageSrc;
    }

    // Otherwise, try to get the image as base64 by taking a screenshot of it
    if (captchaImage) {
        try {
            console.log('Attempting to screenshot captcha image element...');
            const base64 = await captchaImage.screenshot({ encoding: 'base64' });
            return `data:image/png;base64,${base64}`;
        } catch (e) {
            console.log('Could not screenshot captcha image element:', e.message);
        }
    }

    // Debug: Log all images on the page
    try {
        const allImages = await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img'));
            return images.map(img => ({
                src: img.src ? img.src.substring(0, 100) : 'no src',
                id: img.id || 'no id',
                className: img.className || 'no class'
            }));
        });
        console.log('All images on page:', JSON.stringify(allImages, null, 2));
    } catch (e) {
        console.log('Error logging all images:', e.message);
    }

    throw new Error('Could not find captcha image on the page');
}

/**
 * Login to Energo dashboard using Puppeteer
 * @param {Object} options - Login options
 * @param {string} options.username - Username for login
 * @param {string} options.password - Password for login
 * @param {string} [options.captcha] - Optional captcha code. If not provided, will be solved using OpenAI API
 * @param {string} [options.openaiApiKey] - OpenAI API key for captcha solving (uses OPENAI_API_KEY env var if not provided)
 * @param {boolean} [options.headless=true] - Run browser in headless mode
 * @param {number} [options.timeout=30000] - Timeout in milliseconds
 * @returns {Promise<Object>} - Returns session info including cookies and browser instance
 */
async function loginToEnergo({ username, password, captcha, openaiApiKey, headless = true, timeout = 30000 }) {
    let browser = null;
    
    try {
        // Configure browser launch options
        const launchOptions = {
            headless: headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu']
        };
        
        // On Vercel, use @sparticuz/chromium
        if (isVercel) {
            try {
                const chromium = require('@sparticuz/chromium');
                // Use cached path if available, otherwise get it (cache to avoid repeated extraction)
                if (!cachedChromiumPath) {
                    const executablePath = chromium.executablePath();
                    if (executablePath instanceof Promise) {
                        cachedChromiumPath = await executablePath;
                    } else {
                        cachedChromiumPath = executablePath;
                    }
                }
                launchOptions.executablePath = cachedChromiumPath;
                // Add additional args for serverless
                launchOptions.args = [
                    ...launchOptions.args,
                    ...(chromium.args || []),
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ];
                console.log('✅ Using @sparticuz/chromium for Vercel environment');
            } catch (chromiumError) {
                console.warn('⚠️  @sparticuz/chromium not available, trying default puppeteer:', chromiumError.message);
                // Continue with default puppeteer (might fail on Vercel)
            }
        } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            // Cloud Run or other container: use system Chromium from Dockerfile
            launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            console.log('✅ Using system Chromium from PUPPETEER_EXECUTABLE_PATH');
        }
        
        // Launch browser with retry logic for ETXTBSY errors
        let retries = 3;
        let launchError = null;
        
        while (retries > 0) {
            try {
                browser = await puppeteer.launch(launchOptions);
                break; // Success, exit retry loop
            } catch (error) {
                launchError = error;
                const errorMsg = error.message || '';
                
                // Check if it's an ETXTBSY error (file busy) or similar spawn errors
                if ((errorMsg.includes('ETXTBSY') || errorMsg.includes('spawn') || errorMsg.includes('EAGAIN')) && retries > 1) {
                    retries--;
                    const waitTime = (4 - retries) * 1000; // Exponential backoff: 1s, 2s, 3s
                    console.warn(`⚠️  Browser launch error (${errorMsg}), retrying in ${waitTime}ms... (${retries} retries left)`);
                    await delay(waitTime);
                    continue;
                }
                
                // If it's not a retryable error or we're out of retries, throw
                throw error;
            }
        }
        
        // If we exhausted retries, throw the last error
        if (!browser && launchError) {
            throw launchError;
        }

        const page = await browser.newPage();
        
        // Set viewport
        await page.setViewport({ width: 1280, height: 720 });
        
        const capture = setupBearerCapture(page);
        
        // Navigate to login page
        console.log('Navigating to login page...');
        await page.goto('https://backend.energo.vip/login', {
            waitUntil: 'networkidle2',
            timeout: timeout
        });

        let loginSubmitResult = null;
        for (let captchaAttempt = 1; captchaAttempt <= CAPTCHA_MAX_ATTEMPTS; captchaAttempt++) {
            if (captchaAttempt > 1) {
                console.log(`Retrying login with fresh captcha (attempt ${captchaAttempt}/${CAPTCHA_MAX_ATTEMPTS})...`);
                await page.goto('https://backend.energo.vip/login', {
                    waitUntil: 'networkidle2',
                    timeout: timeout
                });
                await delay(2000);
            }

            loginSubmitResult = await fillAndSubmitLoginForm(page, {
                username,
                password,
                captcha,
                openaiApiKey,
                headless,
                timeout,
            });

            if (loginSubmitResult.ok) {
                break;
            }

            if (loginSubmitResult.stage === 'login_rejected') {
                break;
            }
        }

        if (!loginSubmitResult || !loginSubmitResult.ok) {
            await saveDebugArtifacts(page, loginSubmitResult?.stage || 'login_failed');
            return {
                success: false,
                stage: loginSubmitResult?.stage || 'captcha_failed',
                error: loginSubmitResult?.error || 'Login failed after captcha attempts',
                retriable: loginSubmitResult?.stage !== 'login_rejected',
                cookies: [],
                url: page.url(),
                title: await page.title().catch(() => ''),
                token: null,
                captureSource: null,
                browser,
                page,
            };
        }

        // Force dashboard API traffic if token not captured yet
        if (!capture.getToken()) {
            console.log('Navigating to device list to trigger Energo API calls...');
            try {
                await page.goto('https://backend.energo.vip/device/list', {
                    waitUntil: 'networkidle2',
                    timeout: timeout
                });
            } catch (navErr) {
                console.warn('Device list navigation warning:', navErr.message);
            }
        }

        if (!capture.getToken()) {
            console.log(`Waiting up to ${TOKEN_CAPTURE_TIMEOUT_MS}ms for bearer token capture...`);
            await capture.waitForToken(TOKEN_CAPTURE_TIMEOUT_MS);
        }

        let cookies = [];
        let currentUrl = '';
        let pageTitle = '';
        try {
            cookies = await page.cookies();
            currentUrl = page.url();
            pageTitle = await page.title();
        } catch (e) {
            const isSessionClosed = e.name === 'TargetCloseError' ||
                (e.message && (e.message.includes('Session closed') || e.message.includes('Protocol error')));
            if (isSessionClosed) {
                console.log('Page session closed before reading cookies/url/title (common on Cloud Run). Token may still be captured.');
            } else {
                throw e;
            }
        }

        const capturedToken = capture.getToken();
        if (!capturedToken) {
            await saveDebugArtifacts(page, 'token_not_captured');
        }

        return {
            success: !!capturedToken,
            stage: capturedToken ? null : 'token_not_captured',
            cookies,
            url: currentUrl,
            title: pageTitle,
            token: capturedToken,
            captureSource: capture.getCaptureSource(),
            browser,
            page,
        };

    } catch (error) {
        console.error('Login error:', error);
        if (browser) {
            await browser.close();
        }
        const msg = error.message || String(error);
        const stage = msg.includes('ETXTBSY') || msg.includes('spawn') || msg.includes('Browser')
            ? 'browser_launch_failed'
            : 'browser_launch_failed';
        const wrapped = new Error(msg);
        wrapped.stage = stage;
        wrapped.retriable = true;
        throw wrapped;
    }
}

/**
 * Fill login form, solve captcha, submit — one attempt on the current page.
 */
async function fillAndSubmitLoginForm(page, { username, password, captcha, openaiApiKey, headless, timeout }) {
        // Wait for the login form to be visible
        await page.waitForSelector('input[type="text"], input[type="email"], input[name*="username"], input[name*="user"], input[id*="username"], input[id*="user"]', { timeout: timeout });
        
        console.log('Waiting for page to fully load (including captcha image)...');
        await delay(2000);
        
        console.log('Filling username...');
        const usernameField = await page.$('input[type="text"], input[type="email"], input[name*="username"], input[name*="user"], input[id*="username"], input[id*="user"], input[placeholder*="username" i], input[placeholder*="user" i]');
        if (usernameField) {
            await usernameField.click({ clickCount: 3 });
            await usernameField.type(username, { delay: 50 });
        } else {
            throw new Error('Username field not found');
        }

        console.log('Filling password...');
        const passwordField = await page.$('input[type="password"], input[name*="password"], input[name*="pass"], input[id*="password"], input[id*="pass"]');
        if (passwordField) {
            await passwordField.click({ clickCount: 3 });
            await passwordField.type(password, { delay: 50 });
        } else {
            throw new Error('Password field not found');
        }

        console.log('Handling captcha...');
        let captchaField = null;
        const captchaSelectors = [
            'input[name*="captcha" i]',
            'input[id*="captcha" i]',
            'input[placeholder*="captcha" i]',
            'input[type="text"][name*="code" i]',
            'input[type="text"][id*="code" i]',
            'input[type="text"][placeholder*="code" i]',
            'input[type="text"][placeholder*="verify" i]'
        ];

        for (const selector of captchaSelectors) {
            captchaField = await page.$(selector);
            if (captchaField) {
                console.log(`Found captcha field with selector: ${selector}`);
                break;
            }
        }

        if (captchaField) {
            let captchaCode = captcha;
            
            if (!captchaCode) {
                try {
                    const apiKey = openaiApiKey || process.env.OPENAI_API_KEY;
                    if (!apiKey) {
                        return {
                            ok: false,
                            stage: 'missing_env',
                            error: 'OpenAI API key not provided. Set OPENAI_API_KEY environment variable.',
                            retriable: false,
                        };
                    }
                    console.log('Extracting captcha image...');
                    const captchaImage = await extractCaptchaImage(page);
                    console.log('Solving captcha with OpenAI...');
                    captchaCode = await solveCaptchaWithOpenAI(captchaImage, apiKey);
                } catch (error) {
                    console.error('Failed to solve captcha automatically:', error.message);
                    if (headless) {
                        return {
                            ok: false,
                            stage: 'captcha_failed',
                            error: error.message || 'Captcha solving failed',
                            retriable: true,
                        };
                    }
                    console.log('Waiting for manual captcha input...');
                    try {
                        await page.waitForFunction(
                            () => {
                                const selectors = [
                                    'input[name*="captcha" i]',
                                    'input[id*="captcha" i]',
                                    'input[placeholder*="captcha" i]',
                                    'input[type="text"][name*="code" i]',
                                    'input[type="text"][id*="code" i]',
                                    'input[type="text"][placeholder*="code" i]',
                                    'input[type="text"][placeholder*="verify" i]'
                                ];
                                for (const selector of selectors) {
                                    const field = document.querySelector(selector);
                                    if (field && field.value && field.value.length > 0) {
                                        return true;
                                    }
                                }
                                return false;
                            },
                            { timeout: 120000 }
                        );
                        captchaCode = await page.evaluate(() => {
                            const selectors = [
                                'input[name*="captcha" i]',
                                'input[id*="captcha" i]',
                                'input[placeholder*="captcha" i]',
                                'input[type="text"][name*="code" i]',
                                'input[type="text"][id*="code" i]',
                                'input[type="text"][placeholder*="code" i]',
                                'input[type="text"][placeholder*="verify" i]'
                            ];
                            for (const selector of selectors) {
                                const field = document.querySelector(selector);
                                if (field && field.value) {
                                    return field.value;
                                }
                            }
                            return null;
                        });
                    } catch (waitError) {
                        return {
                            ok: false,
                            stage: 'captcha_failed',
                            error: 'Manual captcha input timeout or failed. Original error: ' + error.message,
                            retriable: true,
                        };
                    }
                }
            }
            
            if (captchaCode) {
                await captchaField.click({ clickCount: 3 });
                await captchaField.type(captchaCode, { delay: 50 });
                console.log('Captcha code entered');
            }
        } else {
            console.log('Captcha field not found, proceeding without captcha input');
        }

        await delay(500);

        console.log('Submitting form...');
        const submitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Login")',
            'button:has-text("Sign in")',
            'button:has-text("Log in")',
            'button:has-text("Вход")',
            '[onclick*="login" i]',
            '[onclick*="submit" i]'
        ];

        let submitButton = null;
        for (const selector of submitSelectors) {
            try {
                submitButton = await page.$(selector);
                if (submitButton) {
                    break;
                }
            } catch (e) {
                // Continue to next selector
            }
        }

        if (!submitButton) {
            const buttons = await page.$$('button');
            if (buttons.length > 0) {
                submitButton = buttons[0];
            }
        }

        if (submitButton) {
            await submitButton.click();
        } else {
            await passwordField.press('Enter');
        }

        console.log('Waiting for login to complete...');
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        } catch (e) {
            console.log('No navigation detected, checking for error messages...');
        }

        const errorSelectors = [
            '.error',
            '.alert-danger',
            '[class*="error" i]',
            '[id*="error" i]',
            'div:has-text("Invalid")',
            'div:has-text("incorrect")',
            'div:has-text("неверный" i)',
            'div:has-text("ошибка" i)'
        ];

        let hasError = false;
        for (const selector of errorSelectors) {
            try {
                const errorElement = await page.$(selector);
                if (errorElement) {
                    const errorText = await page.evaluate(el => el.textContent, errorElement);
                    if (errorText && errorText.trim().length > 0) {
                        console.log(`Error detected: ${errorText}`);
                        hasError = true;
                        break;
                    }
                }
            } catch (e) {
                const isSessionClosed = e.name === 'TargetCloseError' ||
                    (e.message && (e.message.includes('Session closed') || e.message.includes('Protocol error')));
                if (isSessionClosed) {
                    break;
                }
            }
        }

        let currentUrl = '';
        try {
            currentUrl = page.url();
        } catch (_) {
            currentUrl = '';
        }

        if (hasError) {
            return {
                ok: false,
                stage: 'login_rejected',
                error: 'Login rejected by Energo (invalid credentials or captcha)',
                retriable: false,
            };
        }

        if (currentUrl === 'https://backend.energo.vip/login') {
            return {
                ok: false,
                stage: 'captcha_failed',
                error: 'Still on login page after submit (likely captcha failure)',
                retriable: true,
            };
        }

        return { ok: true };
}

/**
 * Close browser instance
 * @param {Object} result - Result object from loginToEnergo function
 */
async function closeBrowser(result) {
    if (result && result.browser) {
        await result.browser.close();
        console.log('Browser closed');
    }
}

/**
 * Resolve station id for Energo cabinet probe (env or latest stations row).
 */
async function resolveProbeStationId(dbClient) {
    let stationId = process.env.TOKEN_HEALTH_PROBE_STATION_ID
        ? String(process.env.TOKEN_HEALTH_PROBE_STATION_ID).trim()
        : '';
    if (!stationId && dbClient) {
        const stRes = await dbClient.query(
            'SELECT id::text AS id FROM stations ORDER BY updated_at DESC NULLS LAST LIMIT 1',
        );
        if (stRes.rows.length > 0 && stRes.rows[0].id) {
            stationId = String(stRes.rows[0].id).trim();
        }
    }
    return stationId || null;
}

/**
 * Probe Energo with captured token; require 2xx before persisting.
 */
async function validateCapturedToken(token, dbClient) {
    const stationId = await resolveProbeStationId(dbClient);
    if (!stationId) {
        return {
            valid: false,
            httpStatus: null,
            probedWithStationId: null,
            error: 'No station id available for token probe. Set TOKEN_HEALTH_PROBE_STATION_ID or add stations rows.',
        };
    }
    try {
        const response = await fetchEnergoCabinetProbe(token, stationId);
        const ok = response.status >= 200 && response.status < 300;
        return {
            valid: ok,
            httpStatus: response.status,
            probedWithStationId: stationId,
            error: ok ? null : `Energo probe returned HTTP ${response.status}`,
        };
    } catch (err) {
        return {
            valid: false,
            httpStatus: null,
            probedWithStationId: stationId,
            error: err.message || String(err),
        };
    }
}

async function saveTokenToDatabase(token) {
    if (!tokenPool) {
        console.warn('⚠️ Token pool not available, skipping database save');
        return { saved: false, error: 'Token database pool is not available.' };
    }
    let dbClient;
    try {
        dbClient = await tokenPool.connect();
        await dbClient.query('DELETE FROM token');
        await dbClient.query('INSERT INTO token (value) VALUES ($1)', [token]);
        console.log('✅ Token saved to database successfully');
        return { saved: true };
    } catch (dbError) {
        console.error('❌ Error saving token to database:', dbError);
        return { saved: false, error: dbError.message || String(dbError) };
    } finally {
        if (dbClient) {
            dbClient.release();
        }
    }
}

/**
 * Run loginToEnergo with retries on retriable failures.
 */
async function extractTokenWithRetries({ username, password, openaiApiKey }) {
    const backoffs = [5000, 15000];
    let lastFailure = extractionFailure('token_not_captured', 'Extraction failed');

    for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt++) {
        const startedAt = Date.now();
        let loginResult = null;
        try {
            loginResult = await loginToEnergo({
                username,
                password,
                captcha: undefined,
                openaiApiKey,
                headless: true,
                timeout: 30000,
            });

            if (!loginResult.token) {
                lastFailure = extractionFailure(
                    loginResult.stage || 'token_not_captured',
                    loginResult.error || 'Token was not captured after login',
                    { retriable: loginResult.retriable !== false, httpStatus: 500, extra: { url: loginResult.url } },
                );
                logExtractionMetric({
                    attempt,
                    stage: lastFailure.stage,
                    durationMs: Date.now() - startedAt,
                    captureSource: loginResult.captureSource || null,
                    success: false,
                });
            } else {
                let dbClient;
                try {
                    if (tokenPool) {
                        dbClient = await tokenPool.connect();
                    }
                    const probe = await validateCapturedToken(loginResult.token, dbClient);
                    if (!probe.valid) {
                        lastFailure = extractionFailure(
                            'token_probe_failed',
                            probe.error || 'Captured token failed Energo probe',
                            {
                                retriable: true,
                                httpStatus: 500,
                                extra: {
                                    probeHttpStatus: probe.httpStatus,
                                    probedWithStationId: probe.probedWithStationId,
                                },
                            },
                        );
                        logExtractionMetric({
                            attempt,
                            stage: 'token_probe_failed',
                            durationMs: Date.now() - startedAt,
                            captureSource: loginResult.captureSource || null,
                            probeStatus: probe.httpStatus,
                            success: false,
                        });
                    } else {
                        const saveResult = await saveTokenToDatabase(loginResult.token);
                        if (!saveResult.saved) {
                            lastFailure = extractionFailure(
                                'db_save_failed',
                                saveResult.error || 'Failed to save token to database',
                                { retriable: true, httpStatus: 500 },
                            );
                            logExtractionMetric({
                                attempt,
                                stage: 'db_save_failed',
                                durationMs: Date.now() - startedAt,
                                captureSource: loginResult.captureSource || null,
                                probeStatus: probe.httpStatus,
                                success: false,
                            });
                        } else {
                        logExtractionMetric({
                            attempt,
                            stage: 'success',
                            durationMs: Date.now() - startedAt,
                            captureSource: loginResult.captureSource || null,
                            probeStatus: probe.httpStatus,
                            success: true,
                        });
                        return {
                            success: true,
                            token: loginResult.token,
                            httpStatus: 200,
                            probedWithStationId: probe.probedWithStationId,
                            dbSaved: true,
                        };
                        }
                    }
                } finally {
                    if (dbClient) {
                        dbClient.release();
                    }
                }
            }
        } catch (error) {
            const stage = error.stage || 'browser_launch_failed';
            lastFailure = extractionFailure(stage, error.message || String(error), {
                retriable: error.retriable !== false,
                httpStatus: 500,
            });
            logExtractionMetric({
                attempt,
                stage,
                durationMs: Date.now() - startedAt,
                success: false,
            });
        } finally {
            if (loginResult) {
                try {
                    await closeBrowser(loginResult);
                } catch (closeError) {
                    console.error('Error closing browser:', closeError);
                }
            }
        }

        if (attempt < LOGIN_MAX_ATTEMPTS && lastFailure.retriable) {
            const waitMs = backoffs[attempt - 1] || 15000;
            console.log(`Token extraction attempt ${attempt} failed (${lastFailure.stage}); retrying in ${waitMs}ms...`);
            await delay(waitMs);
        } else {
            break;
        }
    }

    return lastFailure;
}

/**
 * Single-flight wrapper: parallel callers await the same extraction run.
 */
async function runTokenExtraction() {
    if (extractionFlight) {
        return extractionFlight;
    }

    extractionFlight = (async () => {
        const username = process.env.ENERGO_USERNAME;
        const password = process.env.ENERGO_PASSWORD;
        const openaiApiKey = process.env.OPENAI_API_KEY;

        if (!username || !password) {
            return extractionFailure(
                'missing_env',
                'ENERGO_USERNAME and ENERGO_PASSWORD environment variables are required',
                { retriable: false, httpStatus: 500 },
            );
        }
        if (!openaiApiKey) {
            return extractionFailure(
                'missing_env',
                'OPENAI_API_KEY environment variable is required',
                { retriable: false, httpStatus: 500 },
            );
        }

        return extractTokenWithRetries({ username, password, openaiApiKey });
    })();

    try {
        return await extractionFlight;
    } finally {
        extractionFlight = null;
    }
}

/**
 * Example usage function
 * Run this directly to test the login
 */
async function testLogin() {
    // Get credentials from environment variables
    const username = process.env.ENERGO_USERNAME;
    const password = process.env.ENERGO_PASSWORD;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    
    if (!username) {
        throw new Error('ENERGO_USERNAME environment variable is not set. Please set it in your .env file.');
    }
    
    if (!password) {
        throw new Error('ENERGO_PASSWORD environment variable is not set. Please set it in your .env file.');
    }
    
    if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set. Please set it in your .env file for local development or in Vercel dashboard for production.');
    }
    
    try {
        // Use SHOW_BROWSER_PREVIEW config to toggle browser visibility
        const result = await loginToEnergo({
            username: username,
            password: password,
            captcha: undefined, // Leave undefined to solve with OpenAI, or provide the code
            openaiApiKey: openaiApiKey, // Required: Set via OPENAI_API_KEY environment variable
            headless: !SHOW_BROWSER_PREVIEW, // false = show browser, true = headless
            timeout: 30000
        });

        console.log('Login result:', {
            success: result.success,
            url: result.url,
            title: result.title,
            cookiesCount: result.cookies.length,
            token: result.token || 'Not captured yet'
        });
        
        if (result.token) {
            console.log('\n✅ Authorization token successfully captured!');
        } else {
            console.log('\n⚠️  Authorization token not captured. The cabinet API request may not have been made yet.');
        }

        // Keep browser open for inspection (comment out if you want it to close automatically)
        // await closeBrowser(result);

        return result;
    } catch (error) {
        console.error('Test login failed:', error);
        throw error;
    }
}

// ========================================
// EXPRESS ROUTER FOR TOKEN ENDPOINT
// ========================================
const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

// Database configuration (reusing same connection config as other services)
const CLOUD_SQL_CONNECTION_NAME = process.env.CLOUD_SQL_CONNECTION_NAME || 'keyextract-482721:us-central1:cuub-db';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASS = process.env.DB_PASS || '1Cuubllc!';
const DB_NAME = process.env.DB_NAME || 'postgres';

// Create connection pool for token storage
const poolConfig = {
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
};

const useCloudSql = process.env.CLOUD_SQL_CONNECTION_NAME || CLOUD_SQL_CONNECTION_NAME.includes(':');
if (useCloudSql) {
  poolConfig.host = `/cloudsql/${CLOUD_SQL_CONNECTION_NAME}`;
} else {
  poolConfig.host = process.env.DB_HOST || 'localhost';
  poolConfig.port = process.env.DB_PORT || 5432;
}

// Create pool with error handling to prevent module load failures
let tokenPool;
try {
  tokenPool = new Pool(poolConfig);
  
  // Test database connection
  tokenPool.on('connect', () => {
    console.log('✅ Token Service: Connected to PostgreSQL database');
  });
  
  tokenPool.on('error', (err) => {
    console.error('❌ Token Service: Unexpected error on idle client', err);
    // Don't exit process - let it continue
  });
} catch (error) {
  console.error('❌ Token Service: Error creating database pool:', error);
  // Set tokenPool to null so the endpoint can handle it gracefully
  tokenPool = null;
}

/** Public URL for operators to trigger a fresh token (Puppeteer login). */
const TOKEN_REFRESH_URL = process.env.TOKEN_REFRESH_URL || 'https://api.cuub.tech/token';

/**
 * Probe Energo Relink with the stored bearer token (same pattern as map_service_api).
 * @param {string} token
 * @param {string} stationId
 * @returns {Promise<Response>}
 */
async function fetchEnergoCabinetProbe(token, stationId) {
  const url = `https://backend.energo.vip/api/cabinet?cabinetId=${encodeURIComponent(stationId)}`;
  return fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Referer: 'https://backend.energo.vip/device/list',
      oid: '3526',
    },
  });
}

/**
 * GET /token/health
 * Read-only: uses DB token + one cabinet request to infer whether the token still works.
 * Does not run Puppeteer. Intended for monitoring (e.g. maintenance service → Telegram).
 */
router.get('/token/health', async (req, res) => {
  const checkedAt = new Date().toISOString();
  const baseFields = {
    success: true,
    checkedAt,
    tokenRefreshUrl: TOKEN_REFRESH_URL,
  };

  if (!tokenPool) {
    return res.status(503).json({
      ...baseFields,
      success: false,
      tokenPresent: null,
      tokenValid: null,
      tokenNeedsAttention: true,
      energoApiReachable: null,
      httpStatus: null,
      probedWithStationId: null,
      error: 'Token database pool is not available.',
    });
  }

  let client;
  try {
    client = await tokenPool.connect();
    const tokenResult = await client.query('SELECT value FROM token LIMIT 1');
    const rawToken =
      tokenResult.rows.length > 0 && tokenResult.rows[0].value != null
        ? String(tokenResult.rows[0].value).trim()
        : '';

    if (!rawToken) {
      return res.json({
        ...baseFields,
        tokenPresent: false,
        tokenValid: false,
        tokenNeedsAttention: true,
        energoApiReachable: null,
        httpStatus: null,
        probedWithStationId: null,
        message: 'No token in database. Call GET /token to log in and store a token.',
      });
    }

    let stationId = process.env.TOKEN_HEALTH_PROBE_STATION_ID
      ? String(process.env.TOKEN_HEALTH_PROBE_STATION_ID).trim()
      : '';
    if (!stationId) {
      const stRes = await client.query(
        'SELECT id::text AS id FROM stations ORDER BY updated_at DESC NULLS LAST LIMIT 1',
      );
      if (stRes.rows.length > 0 && stRes.rows[0].id) {
        stationId = String(stRes.rows[0].id).trim();
      }
    }

    if (!stationId) {
      return res.json({
        ...baseFields,
        tokenPresent: true,
        tokenValid: null,
        tokenNeedsAttention: false,
        energoApiReachable: null,
        httpStatus: null,
        probedWithStationId: null,
        message:
          'Token is present but no station id to probe against. Set TOKEN_HEALTH_PROBE_STATION_ID or add rows to `stations`.',
      });
    }

    let energoResponse;
    try {
      energoResponse = await fetchEnergoCabinetProbe(rawToken, stationId);
    } catch (netErr) {
      const msg = netErr && netErr.message ? netErr.message : String(netErr);
      return res.json({
        ...baseFields,
        tokenPresent: true,
        tokenValid: null,
        tokenNeedsAttention: false,
        energoApiReachable: false,
        httpStatus: null,
        probedWithStationId: stationId,
        message: `Could not reach Energo API: ${msg}`,
      });
    }

    const status = energoResponse.status;
    let tokenValid = null;
    let message;

    if (status === 401 || status === 403) {
      tokenValid = false;
      message = 'Energo rejected the bearer token (unauthorized). Refresh with GET /token.';
    } else if (status >= 200 && status < 300) {
      tokenValid = true;
    } else if (status === 404) {
      tokenValid = null;
      message =
        'Energo returned 404 for this cabinet id (token may still be valid; check TOKEN_HEALTH_PROBE_STATION_ID or station id).';
    } else {
      tokenValid = null;
      message = `Energo returned HTTP ${status}; token validity could not be confirmed from this probe alone.`;
    }

    const tokenNeedsAttention = tokenValid === false;

    return res.json({
      ...baseFields,
      tokenPresent: true,
      tokenValid,
      tokenNeedsAttention,
      energoApiReachable: true,
      httpStatus: status,
      probedWithStationId: stationId,
      ...(message ? { message } : {}),
    });
  } catch (err) {
    console.error('Error in /token/health:', err);
    return res.status(503).json({
      success: false,
      checkedAt,
      tokenRefreshUrl: TOKEN_REFRESH_URL,
      tokenPresent: null,
      tokenValid: null,
      tokenNeedsAttention: true,
      energoApiReachable: null,
      httpStatus: null,
      probedWithStationId: null,
      error: err.message || String(err),
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * GET /token
 * Retrieve the Energo API token (single-flight Puppeteer extraction).
 */
router.get('/token', async (req, res) => {
    try {
        const result = await runTokenExtraction();

        if (result.success) {
            return res.json({
                success: true,
                token: result.token,
            });
        }

        const httpStatus = result.httpStatus || (result.stage === 'login_rejected' ? 401 : 500);
        return res.status(httpStatus).json({
            success: false,
            stage: result.stage,
            error: result.error,
            retriable: result.retriable !== false,
            ...(result.url ? { url: result.url } : {}),
            ...(result.probeHttpStatus != null ? { probeHttpStatus: result.probeHttpStatus } : {}),
            ...(result.probedWithStationId ? { probedWithStationId: result.probedWithStationId } : {}),
        });
    } catch (error) {
        console.error('Error in /token endpoint:', error);
        return res.status(500).json({
            success: false,
            stage: error.stage || 'unknown',
            error: error.message || 'An error occurred while retrieving the token',
            retriable: true,
        });
    }
});

// Log when router is loaded
console.log('📦 Token service API router initialized with routes: GET /token/health, GET /token');

// Export functions and router
module.exports = {
    loginToEnergo,
    closeBrowser,
    testLogin,
    solveCaptchaWithOpenAI,
    extractCaptchaImage,
    runTokenExtraction,
    isExtractionInProgress,
    router
};

// If running directly, execute test
if (require.main === module) {
    testLogin().catch(console.error);
}
