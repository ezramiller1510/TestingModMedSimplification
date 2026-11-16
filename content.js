console.log("Content script loaded");

function getNodeText(node) {
    return node ? node.textContent.trim() : "";
}

function parseAppointment(row) {

    const cells = row.querySelectorAll("td");

    //------------------------------------
    // Cell 0
    //------------------------------------

    const cell0 = cells[0];

    const date = getNodeText(cell0.childNodes[0]);

    let strong = cell0.querySelector("strong");
    let startTime = strong.textContent.trim();
    let endTime = strong.nextSibling.textContent.trim();

    const time = startTime //+ endTime;

    const surgeryCenter =
        cell0.childNodes[6]?.textContent.trim() ?? "";

    //------------------------------------
    // Cell 1
    //------------------------------------

    const cell1 = cells[1];
    const patientName = cell1.childNodes[0]?.textContent.trim() ?? ""; 

    const birthdayInfo = cell1.childNodes[2]?.textContent.trim() ?? "";

    const birthdayMatch = birthdayInfo.match(
        /(\d{2}\/\d{2}\/\d{4})\s+\((\d+)\)\s+(\w+)/
    );

    const birthday = birthdayMatch?.[1] ?? "";
    const age = birthdayMatch?.[2] ?? "";
    const gender = birthdayMatch?.[3] ?? "";

    let patientNumber = "";

    [...cell1.childNodes].forEach(node => {

        if(node.textContent?.includes("MRN:")){

            patientNumber = node.textContent
                .replace("MRN:", "")
                .trim();

        }

    });

    //------------------------------------
    // Cell 2
    //------------------------------------

    const cell2 = cells[2];

    let surgeryType = "";
    let patientStatus = "";
    let resource = "";
    let procedureDetails = "";

    const strongs = cell2.querySelectorAll("strong");

    if (strongs.length >= 1)
        surgeryType = strongs[0].textContent.trim();

    if (strongs.length >= 2)
        patientStatus = strongs[1].textContent.trim();

    // if (strongs.length >= 3)
        // resource = strongs[2].textContent.trim();

    // The text after the last <br> contains the procedure details
    const lines = cell2.innerText
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length >= 4)
        procedureDetails = lines[3];


   //------------------------------------
    // Cell 3
    //------------------------------------

    const cell3 = cells[3];

    let phoneNumbers = "";
    

    phoneNumbers = cell3.textContent.trim() ?? "";


    //------------------------------------
    // Cell 4
    //------------------------------------

    const cell4 = cells[4];

    const providerStrong = cell4.querySelector("b");

    const healthcareProvider = cell4.textContent.trim() ?? "";
        

    //------------------------------------
    // Final Object
    //------------------------------------

    return {
        patientName,
        patientNumber,
        surgeryType,
        birthday,
        age,
        gender,
        healthcareProvider,
        date,
        surgeryCenter,
        patientStatus,
        time,
        phoneNumbers,
        procedureDetails
    };

}




function scrapeTable() {
    console.log("is correct page")
    console.log(location.href);

    const gridArea = document.querySelector(".dhx_grid_area");

    if (!gridArea) {
        throw new Error("Could not find .dhx_grid_area");
    }

    const table = gridArea.querySelector("table");

    if (!table) {
        throw new Error("Could not find appointment table.");
    }

    const rows = table.querySelectorAll("tr.scheduler-appointment-event");

    return [...rows].map(parseAppointment);
}




// chrome.runtime.onMessage.addListener((request)=>{
//         console.log("loaded scraper")

//     if(request.action==="scrape"){
//         console.log("working scraper")
//         const appointments = scrapeTable();
//         console.table(appointments);

//     }

// });


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapeTable") {
    try {
        let appointments = scrapeTable();
              // remove lasers appointments if requested
        if (request.removeLaser) {
            appointments = appointments.filter(
                appointment => appointment.surgeryType !== "ASC Laser"
            );
        }

        const scrapedAppointmentData = appointments.map(appointment => {
            const result = {};
            for(const key in request.selectedFields){
                if(request.selectedFields[key]){
                    result[key] = appointment[key];
                }
            }
            return result;
        });

        try {
            const response = chrome.runtime.sendMessage({ action: "convert", data: scrapedAppointmentData });

            console.log("Got response:", response);
        } catch (err) {
            console.error("sendMessage failed:", err);
        }

        sendResponse({ status: "ok", scrapedAppointmentData });
    } catch (err) {
        sendResponse({ status: "error", message: err.message });
    }
  }
  return true; // keep the channel open (scrapeTable is synchronous here, but this is still safe/needed)
});



// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//     console.log("Message received:", request);

//     if (request.action === "scrapeTable") {

//         let appointments = scrapeTable();
        
//         // remove lasers appointments if requested
//         if (request.removeLaser) {
//             appointments = appointments.filter(
//                 appointment => appointment.surgeryType !== "ASC Laser"
//             );
//         }

//         const scrapedAppointmentData = appointments.map(appointment => {
//             const result = {};
//             for(const key in request.selectedFields){
//                 if(request.selectedFields[key]){
//                     result[key] = appointment[key];
//                 }
//             }
//             return result;
//         });



//         // convertDataToDocx(filtered)
//         sendResponse({status: "done"})

//     }

//     return true

// });


// be able to fiter out schedule elements
// dads filters
// i just need the time
// i need the surgery type
// resource information


// can't filter out patient name
// can't filter out time
// can't filter out resource

// everything else you can filter
// paitent number
// surgery type
// patient birthday, age, and gender
// patient healthcare provider
// date
// name of the surgery center
// patient Status