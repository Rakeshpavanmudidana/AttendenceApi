
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
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-zygote"
        ]
        });

    }
    return browser;
}


function groupByCourseBranchSemester(dropdown) {
    const grouped = {};

    for (const item of dropdown) {
        const course = item.course.text;
        const branch = item.branch.text;
        const semester = item.semester.text;

        if (!grouped[course]) {
            grouped[course] = {};
        }

        if (!grouped[course][branch]) {
            grouped[course][branch] = {};
        }

        if (!grouped[course][branch][semester]) {
            grouped[course][branch][semester] = {
                semesterValue: item.semester.value,
                batch: item.semester.batch,
                sections: []
            };
        }

        grouped[course][branch][semester].sections.push(...item.sections);
    }

    return grouped;
}



// Login to get the required iframe ( attendence iframe )
async function loginAndGetFrame(teacher_id, password, functionCallFrom = null) {
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

    if ( functionCallFrom != "get_today_classes" ){

    await page.evaluate(() => {
        LoadLinks(4, "ACADEMICS", "ACADEMICS", "divLeftMenu");
    });
    if ( functionCallFrom != "get_student_profile"){
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
        .catch(() => { });

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
    } catch (e) { }
    }
    else{

        await page.waitForFunction(
        () => {
            const menu = document.querySelector("#divLeftMenu");
            return menu && menu.innerText.includes("STUDENT PROFILE");
        },
        { timeout: 10000 }
        );

        await page.waitForSelector("#MenuLink116", { timeout: 10000 });
        await page.evaluate(() => {
        document.querySelector("#MenuLink116").click();
        });

        await page.waitForFunction(() => {
        const iframe = document.querySelector("#capIframeId");
        return iframe && iframe.src.includes("studentprofile.aspx");
        }, { timeout: 15000 });


    }

    }

    const frameHandle = await page.$("iframe#capIframeId");
    const frame = await frameHandle.contentFrame();

    if ( functionCallFrom == "get_today_classes")
        await frame.waitForSelector("#divtodayclasses");
    else if ( functionCallFrom == "get_student_profile")
        await frame.waitForSelector("#ctl00_CapPlaceHolder_txtRollNo");
    else
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

    const structuredDropdown = groupByCourseBranchSemester(dropdown);

    return {
        success: true,
        AttendanceTypeOptions,
        structuredDropdown
    };
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
async function inputValuesToStudentData(optionsData, frame, functionCallFrom) {

    const attadenceType = optionsData.attadenceType;

    await frame.evaluate((attadenceType) => {

        const radio = document.querySelector("input[id='" + attadenceType.id + "'][value='" + attadenceType.value + "']");
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }, attadenceType);


    const dateField = optionsData.date;

    await frame.evaluate((dateField) => {
        const id = dateField.id;

        document.querySelector("#" + id).value = dateField.value

    }, dateField);


    await frame.select("#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlCourse", optionsData.course.value);
    await frame.evaluate(() => CBSCourseOnChange());

    await frame.select("#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlBranch", optionsData.branch.value);
    await frame.evaluate(() => CBSBranchOnChange());

    await frame.select("#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlSemester", optionsData.semester.value);
    await frame.evaluate(() => _fillSections());

    await frame.select("#ctl00_CapPlaceHolder_CourseBranchSemester1_ddlSection", optionsData.sections.value);




    await frame.evaluate(() => document.querySelector("#btnShow").click());


    console.log("Submiting input.");
    await frame.waitForFunction(() => {
        const div = document.querySelector("#divStudents");
        return div && div.innerHTML.trim() !== "";
    }, { timeout: 30000 });





    // Extracting student data..

    if (functionCallFrom == "get_students_data") {
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

    else {
        return { frame };

    }



}

// To get the student_data for the attendence.

async function get_students_data(teacher_id, password, optionsData) {

    const { frame } = await loginAndGetFrame(teacher_id, password);

    if (!frame) {
        return { error: "iframe failed" };
    }

    console.log("Login Completed.");

    return await inputValuesToStudentData(JSON.parse(optionsData), frame, "get_students_data");



}

// http://localhost:3000/get_student_profile?teacher_id=12139&password=12139&studentIds=['24l35a4306','24l35a4309','24l767']

app.get("/get_student_profile", async (req, res) => {
    const { teacher_id, password, studentIds } = req.query;

    const { frame } = await loginAndGetFrame(teacher_id, password, "get_student_profile");

    let studentProfiles = [];
    const studentIdList = JSON.parse(studentIds);

    for (const id of studentIdList){
        const previousHTML = await frame.evaluate(() => {
    const t = document.querySelector("#tblReport");
    return t ? t.innerHTML : "";
  });

  await frame.evaluate((id) => {
    const input = document.querySelector("#ctl00_CapPlaceHolder_txtRollNo");
    input.value = "";
    input.value = id;
    __doPostBack('ctl00$CapPlaceHolder$btnSearch', '');
  }, id);

  try{
  await frame.waitForFunction(
    (oldHTML) => {
      const t = document.querySelector("#tblReport");
      return t && t.innerHTML !== oldHTML;
    },
    { timeout: 20000 },
    previousHTML
  );
}
catch{
    studentProfiles.push(`{"id":"${id}","No student found"}`);
    continue;
}


     const profile = await frame.evaluate((id) => {
      let table = document.querySelector("#divProfile_BioData table");
      let rows = table.querySelectorAll("tr");

      const name = rows[3]?.querySelectorAll("td")[2]?.innerText.trim();

      const phoneNumber = rows[11]?.querySelectorAll("td")[5]?.innerText.trim();

      const email = rows[12]?.querySelectorAll("td")[2]?.innerText.trim();

      const parentPhoneNumber = rows[24]?.querySelectorAll("td")[5]?.innerText.trim();

      table = document.querySelector("#divProfile_Present table");
      rows = table.querySelectorAll("tr");

      const totalattedence = rows[21]?.querySelectorAll("td")[3]?.innerText.trim();

      const div = document.querySelector('#divProfile_Backlogs');
      const spanText = div.querySelector('span')?.innerText.trim();
        let backlogs = '0';  
        if (spanText === 'Student have no backlogs') {
            console.log('No backlogs');
        } 
      else
      {
        table = div.querySelector("table");
        rows = table.querySelectorAll("tr");

        backlogs = rows[rows.length - 1]?.querySelector("td")?.innerText.trim();

        backlogs = backlogs.replace("Total backlogs:", "");
      }

      return {
        id,
        name,
        phoneNumber,
        email,
        parentPhoneNumber,
        totalattedence,
        backlogs
      };
    }, id);
    console.log("name"+ profile.name);
    studentProfiles.push(profile);

    }
      

  res.json({ success: true, studentProfiles});
});


// http://localhost:3000/get_today_classes?teacher_id=12139&password=12139

app.get("/get_today_classes", async (req, res) => {
  const { teacher_id, password } = req.query;

  const { frame } = await loginAndGetFrame(teacher_id, password, "get_today_classes");

  const text = await frame.evaluate(() => {
    const container = document.querySelector("#divtodayclasses");
    if (!container) return { status: "no-classes" };

    const rows = container.querySelectorAll("tr");
    let output = "";

    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return;

      const periodInfo = cells[0].innerText.trim().split("\n");
      const classInfo = cells[1].innerText.trim().split("\n");

      const periodNumber = periodInfo[0];

      const time = periodInfo[1];

      const subject = classInfo[0] ? classInfo[0] : "No Class";

      const cls = classInfo[1] ? classInfo[1] : "";

      output += periodNumber + "\t\t" + time + "\n" +  subject + "\t\t" + cls + "\n\n\n";
    });

    return  output.trim()
  });

//   console.log(text);

  res.json(text);
});



// http://localhost:3000/set_attendance?teacher_id=12139&password=12139&studentDetails=["21345","12334","56789"...]

app.get("/set_attendance", async (req, res) => {

    const { teacher_id, password, clickType, studentDetails } = req.query;

    if (!teacher_id || !password || !clickType || !studentDetails) {
        return res
            .status(400)
            .json({ error: "Missing teacher_id or password or studentDetails" });
    }
    const { frame } = await loginAndGetFrame(teacher_id, password);

    if (!frame) {
        return { error: "iframe failed" };
    }
    console.log("Login Completed.");

    const FrameAfterOptions = await inputValuesToStudentData(JSON.parse(studentDetails),
        frame, "set_attendance");

    for (student of studentDetails) {
        // set attendance logic here
    }
});



// http://localhost:3000/get_Options_data?teacher_id=12139&password=12139&studentDetails=["21345","12334","56789"...]

app.get("/set_attendance", async (req, res) => {

    const { teacher_id, password, clickType, studentDetails } = req.query;

    if (!teacher_id || !password || !clickType || !studentDetails) {
        return res
            .status(400)
            .json({ error: "Missing teacher_id or password or studentDetails" });
    }
    const { frame } = await loginAndGetFrame(teacher_id, password);

    if (!frame) {
        return { error: "iframe failed" };
    }
    console.log("Login Completed.");

    const FrameAfterOptions = await inputValuesToStudentData(JSON.parse(studentDetails),
        frame, "set_attendance");

    for (student of studentDetails) {
        // set attendance logic here
    }
});



// Request function for student data for attendence
// http://localhost:3000/get_students_data?teacher_id=12139&password=12139&optionsData={"attadenceType":{"id":"radregular","value":"R","label":"Regular"},"date":{"id":"txtDate","value":"16-12-2025"},"course":{"id":"","value":"1","text":"B.Tech"},"semester":{"id":"","value":"3","text":"IV Semester","batch":"2024"},"branch":{"id":"","value":"11","text":"Computer Science and Engineering (Artificial Intelligence)"},"sections":{"id":"","value":"2","text":"Section B"}}

app.get("/get_students_data", async (req, res) => {

    const { teacher_id, password, optionsData } = req.query;

    if (!teacher_id || !password || Object.keys(optionsData).length == 6) {
        return res
            .status(400)
            .json({ error: "Missing teacher_id or password or optionsData" });
    }

    const studentDetails = await get_students_data(
        teacher_id,
        password,
        optionsData
    );

    console.log(studentDetails);
    res.json(studentDetails);

});


// Request to get the input fields in the iframe ( attendence )
// http://localhost:3000/get_Options_data?teacher_id=12139&password=12139

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

