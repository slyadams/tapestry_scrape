const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const sprintf = require("sprintf-js").sprintf;

async function actionWrapper(counter, page, action) {
    const carryon = await action();
    await page.screenshot({ path: `screenshot_${++counter}.png` });
    console.log(`Writing screenshot screenshot_${counter}.png`);
    if (carryon) {
        return counter;
    } else {
        return -1;
    }
}

async function findElement(page, selector, text, debug = false) {
    const elements = await page.$$(selector);

    for (element of elements) {
        const innerHTML = await page.evaluate((e) => e.innerHTML.trim(), element);
        if (debug) {
            console.log(innerHTML);
        }
        if (innerHTML === text) {
            return element;
        }
    }
    return null;
}

async function saveFile(page, element, file) {
    console.log(`Saving ${file}`);
    const url = await page.evaluate((e) => {
        return e.getAttribute("src");
    }, element);
    return axios.get(url, { responseType: "arraybuffer" }).then((response) => fs.writeFile(file, response.data));
}

async function getObsInfo(page) {
    const authoredStringElemenmt = await page.$("div.obs-metadata > p:nth-child(1)");
    const authoredString = await page.evaluate((s) => {
        return s.innerHTML.trim();
    }, authoredStringElemenmt);
    const dateString = authoredString.replace(/^.*added/, "").trim();
    const date = new Date(dateString);

    const titleElement = await page.$("h1");
    const title = await page.evaluate((s) => {
        return s.innerHTML.trim().replace(/[ \\/:*?"!<>|\n]/g, "_");
    }, titleElement);

    return { date: sprintf("%04i-%02i-%02i", date.getFullYear(), date.getMonth() + 1, date.getDate()), title };
}

async function run(host, username, password, output) {
    console.log(password);
    let counter = 0;
    const browser = await puppeteer.launch({
        headless: true,
        // executablePath: `c:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe`,
    });
    const page = await browser.newPage();
    await page.setCacheEnabled(false);

    counter = await actionWrapper(counter, page, async () => {
        return page.goto(host);
    });

    counter = await actionWrapper(counter, page, async () => {
        console.log("Filling in user/pass");
        await page.focus("#email_generated_id");
        await page.keyboard.type(username);
        await page.focus("#password_generated_id");
        await page.keyboard.type(password);
        return true;
    });
    counter = await actionWrapper(counter, page, async () => {
        const button = await page.$("button[type=submit]");
        if (button) {
            console.log("Logging in");
            await button.click();
            await page.waitForNavigation({ waitUntil: "networkidle0" });
            return true;
        } else {
            throw new Error("Login button not found");
        }
    });

    counter = await actionWrapper(counter, page, async () => {
        const button = await findElement(page, "a", "Visit Now");
        if (button) {
            console.log("Entering observations");
            await button.click();
            await page.waitForNavigation({ waitUntil: "networkidle0" });
            return true;
        } else {
            throw new Error("Visit Now button not found");
        }
    });

    counter = await actionWrapper(counter, page, async () => {
        const link = await page.$(
            ".observation-item.status-normal > div.media > div.media-body > div:nth-child(1) > h4 > a"
        );
        if (link) {
            console.log("Entering first observation");
            await link.click();
            await page.waitForNavigation({ waitUntil: "networkidle0" });
            return true;
        } else {
            throw new Error("First observation not found");
        }
    });

    let obsNumber = 0;
    while (counter != -1) {
        const obsInfo = await getObsInfo(page);
        console.log(`Observation ${++obsNumber} (${obsInfo.title})`);

        const obsDirectory = path.join(output, `${obsInfo.date}_${obsInfo.title}`);
        await fs.ensureDir(obsDirectory);
        counter = await actionWrapper(counter, page, async () => {
            const images = await page.$$("img.obs-media");
            const videos = await page.$$("video > source");
            if (images) {
                let imageIdx = 0;
                for (const image of images) {
                    const file = path.join(obsDirectory, `image_${++imageIdx}.jpg`);
                    await saveFile(page, image, file);
                }
            }
            if (videos) {
                let videoIdx = 0;
                for (const video of videos) {
                    const file = path.join(obsDirectory, `video_${++videoIdx}.mp4`);
                    await saveFile(page, video, file);
                }
            }

            const nextLink = await page.$("li.next");
            if (nextLink) {
                await nextLink.click();
                await page.waitForNavigation({ waitUntil: "networkidle0" });
                return true;
            } else {
                console.log("no next link found");
                return false;
            }
        });
    }

    return browser.close();
}

if (process.argv.length != 6) {
    console.log("Provide path, username and password output");
} else {
    run(process.argv[2], process.argv[3], process.argv[4], process.argv[5])
        .then(() => {
            console.log("Done");
        })
        .catch((e) => {
            console.log(e);
        });
}
