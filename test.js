import fs from 'node:fs';
import puppeteer from 'puppeteer';

const target = process.env.TARGET_URL || 'http://localhost:3000/';
const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const getChromeExecutablePath = () => {
  for (const candidate of chromeCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

(async () => {
  const executablePath = getChromeExecutablePath();

  console.log(`Testing target: ${target}`);
  console.log(executablePath ? `Using Chrome: ${executablePath}` : 'No system Chrome found; using Puppeteer bundled browser');

  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    try {
      const response = await page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      console.log('HTTP status:', response && response.status());
      console.log('Page title:', await page.title());

      const bodyText = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        return text.replace(/\s+/g, ' ').trim().slice(0, 500);
      });

      console.log('Body preview:', bodyText || '(empty body)');
    } catch (error) {
      console.error('Navigation failed:', error.message);
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error('Browser launch failed:', error.message);
    console.error('This is a local Puppeteer/Chrome compatibility issue, not a Cloudflare result.');
  }
})();
