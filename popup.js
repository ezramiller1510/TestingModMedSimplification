

function showError(msg) {
    const el = document.getElementById("error");
    el.textContent = msg;
    el.style.display = "block";
}


const scrapeButton = document.getElementById("scrape");

scrapeButton.onclick = async () => {
// ----------------test code---------------


// -------------test code ----------------------
    const selectedFields = {};

    document.querySelectorAll("input[type=checkbox]").forEach(box => {

        selectedFields[box.id] = box.checked;

    });
    const removeLaser = document.getElementById("removeLaser").checked;

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    try {
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: "scrapeTable",
            selectedFields,
            removeLaser,
        });

        if (response?.status === "error") {
            showError(response.message); // e.g. "Could not find .dhx_grid_area"
        } else {
            // proceed with response.data
        }
    } catch (err) {
        // this catch is for the *messaging* failing entirely —
        // e.g. content script not injected on this tab at all
        showError("Could not connect to the page. Try reloading it.");
    }

};



