const express = require("express");
const crypto = require("crypto");
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

const app = express();

// Password encryption

function encryptPassword(plaintext, key, iv) {
    const cipher = crypto.createCipheriv(
        "aes-128-cbc",
        Buffer.from(key, "utf8"),
        Buffer.from(iv, "utf8")
    );
    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");
    return encrypted;
}


let browser = null;


// Browser is global

async function getBrowser() {

    if (!browser) {
        browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox"],
        });
    }
    return browser;
}


// Login to get the required iframe ( attendence iframe )

async function loginAndGetFrame(teacher_id, password) {

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto("https://webprosindia.com/vignanit/default.aspx#", {
        waitUntil: "networkidle2",
    });

    const html = await page.content();
    const $ = cheerio.load(html);

    const viewstate = $("input[name='__VIEWSTATE']").val();
    const viewstate_generator = $("input[name='__VIEWSTATEGENERATOR']").val();
    const event_validation = $("input[name='__EVENTVALIDATION']").val();

    if (!viewstate || !viewstate_generator || !event_validation) {
        await browser.close();
        return { error: "Failed to extract login form data" };
    }

    const key = "8701661282118308";
    const iv = "8701661282118308";
    const encrypted_password = encryptPassword(password, key, iv);

    await page.type("#txtId1", teacher_id);
    await page.type("#txtPwd1", password);

    await page.evaluate((encrypted_password) => {
        document.querySelector("#hdnpwd1").value = encrypted_password;
    }, encrypted_password);

    await Promise.all([
        page.click("#imgBtn1"),
        page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    await page.goto("https://webprosindia.com/vignanit/main.aspx#", {
        waitUntil: "networkidle2",
    });

    await page.evaluate(() => {
        LoadLinks(4, "ACADEMICS", "ACADEMICS", "divLeftMenu");
    });

    await page.waitForFunction(
        () => {
        const menu = document.querySelector("#divLeftMenu");
        return menu && menu.innerText.includes("FACULTY");
        },
        { timeout: 10000 }
    );

    await page.evaluate(() => {
        const menuBar = document.querySelector("#divLeftMenu a#MenuLink57");
        if (!menuBar) return;
        const maintr = menuBar.closest("tr");
        if (!maintr) return;
        const rect = maintr.getBoundingClientRect();
        maintr.dispatchEvent(
        new MouseEvent("mouseover", {
            bubbles: true,
            clientX: rect.left + 5,
            clientY: rect.top + 5,
        })
        );
    });

    await new Promise((r) => setTimeout(r, 1000));

    await page
        .waitForFunction(
        () => {
            const d = document.querySelector("#div_183");
            return (
            d &&
            d.querySelectorAll("span.menuLink, a.menuLink").length > 0 &&
            getComputedStyle(d).display !== "none"
            );
        },
        { timeout: 10000 }
        )
        .catch(() => {});

    const clicked = await page.evaluate(() => {
        const container = document.querySelector("#div_183");
        if (!container) return false;
        const items = Array.from(
        container.querySelectorAll("span.menuLink, a.menuLink")
        );
        const target = items.find((el) => {
        const t = (el.textContent || "").trim().toUpperCase();
        return t === "ATTENDANCE" || t.includes("ATTENDANCE");
        });
        if (!target) return false;
        target.click();
        return true;
    });

    if (!clicked) {
        await page.evaluate(() => {
        const container = document.querySelector("#div_183");
        if (!container) return false;
        const item = container.querySelector("span.menuLink, a.menuLink");
        if (!item) return false;
        item.scrollIntoView({ block: "center" });
        const r = item.getBoundingClientRect();
        const evt = new MouseEvent("click", {
            bubbles: true,
            clientX: r.left + 5,
            clientY: r.top + 5,
        });
        item.dispatchEvent(evt);
        return true;
        });
    }

    try {
        await page.waitForNavigation({ timeout: 8000, waitUntil: "networkidle2" });
    } catch (e) {}

    const frameHandle = await page.$("iframe#capIframeId");
    const frame = await frameHandle.contentFrame();
    await frame.waitForSelector("#txtDate", { timeout: 15000 });

    

    return { page, frame };

}


// To get the all options

async function getAllOptions(teacher_id, password) {

    const { frame } = await loginAndGetFrame(teacher_id, password);

    if (!frame) {
        return { error: "iframe failed" };
    }
    console.log("Login Completed.");

    const AttendanceTypeOptions = await frame.evaluate(() =>
        Array.from(document.querySelectorAll("input[name='radtype']")).map((r) => ({
        id: r.id,
        value: r.value,
        label: r.nextSibling.textContent.trim(),
        }))
    );

    dropdown = await extractAllDropdownData(frame);
    

    return { success: true, AttendanceTypeOptions: AttendanceTypeOptions, dropdown: dropdown };

}


// To get the Dropdown options which are depend on previous option

async function extractAllDropdownData(frame) {

    const data = [];

    const courses = await frame.evaluate(() =>
        Array.from(
        document.querySelectorAll(
            "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlCourse option"
        )
        ).map((o) => ({ id: o.id, value: o.value, text: o.textContent.trim() }))
    );

    for (const course of courses) {
        await frame.select(
        "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlCourse",
        course.value
        );
        await frame.evaluate(() => CBSCourseOnChange());
        await frame.waitForFunction(() =>
        document.querySelector(
            "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlBranch option"
        )
        );

        const branches = await frame.evaluate(() =>
        Array.from(
            document.querySelectorAll(
            "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlBranch option"
            )
        ).map((o) => ({ id: o.id, value: o.value, text: o.textContent.trim() }))
        );

        for (const branch of branches) {
        await frame.select(
            "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlBranch",
            branch.value
        );
        await frame.evaluate(() => CBSBranchOnChange());
        await frame.waitForFunction(() =>
            document.querySelector(
            "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlSemester option"
            )
        );

        const semesters = await frame.evaluate(() =>
            Array.from(
            document.querySelectorAll(
                "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlSemester option"
            )
            ).map((o) => ({
                id: o.id,
                value: o.value,
                text: o.textContent.trim(),
                batch: o.getAttribute("title"),
            }))
        );

        for (const sem of semesters) {
            await frame.select(
            "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlSemester",
            sem.value
            );
            await frame.evaluate(() => _fillSections());
            await frame.waitForFunction(() =>
            document.querySelector(
                "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlSection option"
            )
            );

            const sections = await frame.evaluate(() =>
            Array.from(
                document.querySelectorAll(
                "#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlSection option"
                )
            ).map((o) => ({ id: o.id, value: o.value, text: o.textContent.trim() }))
            );

            data.push({
            course,
            branch,
            semester: sem,
            sections,
            });
        }
        }
    }

    return data;

}

// To set all the input values to inputFields to get the studentsData

async function inputValuesToStudentData( optionsData, frame ) {

    // optionsData { attadenceType: { id: value, value: value }, date: value, course: { id: value, value: value}, 
    // semester: { id: value, value: value}, branch: { id: value, value: value }, section: {id: value, value: value }}

    // optionsData = {"attadenceType":{"id":"radsubstitute","value":"S"},"date":{"id":"txtDate","value":"25-11-2025"}};
    
    const attadenceType = optionsData.attadenceType;
    
    await frame.evaluate(( attadenceType ) => {
        
        const radio = document.querySelector( "input[id='" + attadenceType.id + "'][value='" + attadenceType.value + "']" );
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }, attadenceType);


    const dateField = optionsData.date;
    
    await frame.evaluate( (dateField) => {
        const id = dateField.id;

        document.querySelector("#" + id).value = dateField.value

    }, dateField);


    // const courseInput = optionsData.course;




    // const course = optionsData.course;

    await frame.evaluate(() => document.querySelector("#btnShow").click());


    console.log("Submiting input.");
    await frame.waitForFunction(() => {
    const div = document.querySelector("#divStudents");
    return div && div.innerHTML.trim() !== "";
    }, { timeout: 30000 });


    // Extracting student data..
    console.log("Extracting student data.");
    const result = await frame.evaluate(() => {
    const container = document.querySelector("#divStudents");
    const html = container.innerHTML.trim();

    // Case: span exists → error message
    const span = container.querySelector("span");
    if (span) {
        return {
        status: "error",
        message: span.innerText.trim(),
        rawHTML: html
        };
    }

    // Case: table exists → student data
    const table = container.querySelector("table");
    if (table) {
        const rows = Array.from(table.querySelectorAll("tr")).map(tr => tr.innerText.trim());
        return {
        status: "success",
        count: rows.length - 1,
        rows,
        rawHTML: html
        };
    }

    // Case: div exists but is empty or unexpected
    return {
        status: "unknown",
        rawHTML: html
    };
    });


    return result;

    
}

// To get the student_data for the attendence.

async function get_students_data(teacher_id, password, optionsData) {

    const { frame } = await loginAndGetFrame(teacher_id, password);

    if (!frame) {
        return { error: "iframe failed" };
    }

    console.log("Login Completed."); 

    return await inputValuesToStudentData(JSON.parse(optionsData), frame );



}


// Request function for student data for attendence
// http://localhost:3000/get_students_data?teacher_id=12139&password=12139&optionsData={%22attadenceType%22:{%22id%22:%22radregular%22,%22value%22:%22R%22},%22date%22:{%22id%22:%22txtDate%22,%22value%22:%2229-11-2025%22}}
// ( localhost )

app.get("/get_students_data", async (req, res) => {

    const { teacher_id, password, optionsData } = req.query;

    // if (!teacher_id || !password || Object.keys(optionsData).length > 6  ) {
    //     return res
    //     .status(400)
    //     .json({ error: "Missing teacher_id or password or optionsData" });
    // }

    const studentDetails = await get_students_data(
        teacher_id,
        password,
        optionsData
    );

    console.log(studentDetails);
    res.json(studentDetails);

});


// Request to get the input fields in the iframe ( attendence )
// http://localhost:3000/get_Options_data?teacher_id=12139&password=12139 ( localhost )

app.get("/get_Options_data", async (req, res) => {

    const { teacher_id, password } = req.query;

    if (!teacher_id || !password) {
        return res
        .status(400)
        .json({ error: "Missing teacher_id or password" });
    }

    const result = await getAllOptions(teacher_id, password);

    console.log("Extracting options Completed.");

    res.json(result);

});


// the port = 3000

app.listen(3000, () => console.log("Server running on port 3000"));
