import { Document, Packer, Paragraph, Table, TableRow, TableCell, 
        TextRun, WidthType, TableLayoutType, HeightRule, PageOrientation } from './docx.esm.js';


const PAGE_ORIENTATION = "portrait";
const PAGE_MARGIN = 720; // 0.5" per side, in DXA

const PAGE_WIDTH_DXA = PAGE_ORIENTATION === "landscape" ? 15840 : 12240;
const PAGE_HEIGHT_DXA = PAGE_ORIENTATION === "landscape" ? 12240 : 15840;

const USABLE_WIDTH_DXA = PAGE_WIDTH_DXA - (PAGE_MARGIN * 2); // left + right margins
// ------------------------------------------------------

const NOTES_COLUMN_WIDTH = 2880;// 2.0" //2160; // 1.5"
const MIN_ROW_HEIGHT = 720;      // 0.5"
const HEADER_HEIGHT = 300;

const COLUMN_DEFINITIONS = [
    { title: "Schedule", 
        fields: [
            { key: "date" },
            { key: "time" },
            { key: "surgeryCenter" }
        ], weight: 0.15 },

    { title: "Patient", 
        fields: [
            { key: "patientName", bold:true },
            { key: "birthday"},
            { key: "age" },
            { key: "gender" },
            { key: "patientNumber", prefix: "MRN: " },
        ], weight: 0.2 },
    { title: "Surgery", 
        fields: [
            { key: "surgeryType" },
            { key: "patientStatus" },
            { key: "procedureDetails" }
        ], weight: 0.4 },
    { title: "Phone", 
        fields: [
            { key: "phoneNumbers" }
        ], weight: 0.2 },
    { title: "Healthcare Provider", 
        fields: [
            { key: "healthcareProvider" }
        ], weight: 0.2 },
    { title: "Notes", fields: [{key: "notes"}], alwaysShow: true } // width handled separately below, weight unused
];

function computeColumnWidths(activeIndices) {
    const notesActive = activeIndices.some(i => COLUMN_DEFINITIONS[i].title === "Notes");
    const remainingWidth = notesActive ? USABLE_WIDTH_DXA - NOTES_COLUMN_WIDTH : USABLE_WIDTH_DXA;

    const flexIndices = activeIndices.filter(i => COLUMN_DEFINITIONS[i].title !== "Notes");
    const totalWeight = flexIndices.reduce((sum, i) => sum + (COLUMN_DEFINITIONS[i].weight ?? 1), 0);

    const widths = {};
    flexIndices.forEach(i => {
        const weight = COLUMN_DEFINITIONS[i].weight ?? 1;
        widths[i] = Math.round((weight / totalWeight) * remainingWidth);
    });
    if (notesActive) {
        widths[activeIndices.find(i => COLUMN_DEFINITIONS[i].title === "Notes")] = NOTES_COLUMN_WIDTH;
    }

    return widths;
}




function buildColumn(appointment, fields) {
    const runs = [];

    fields.forEach(field => {
        if (field.key == "notes"){
            runs.push(new TextRun({ text: "", break: 1 }))
        }


        if (appointment[field.key]) {
            let value = appointment[field.key];

            if (field.prefix) {
                value = field.prefix + value;
            }

            if (runs.length > 0) {
                // line break before each subsequent field's value
                runs.push(new TextRun({ text: "", break: 1 }));
            }

            runs.push(new TextRun({
                text: value,
                bold: field.bold // or just `!!field.bold` if you switch to a real boolean
            }));
        }
    });

    return runs.length > 0 ? runs : null;
}



// Always returns one entry per column definition, in order.
// Empty groups become null (not skipped) so every appointment's
// array lines up by index with every other appointment's array.
function buildColumns(appointment) {
    return COLUMN_DEFINITIONS.map(definition =>
        buildColumn(appointment, definition.fields)
    );
}

// Given all appointments, find which column indices have data
// in at least one appointment.
function getActiveColumnIndices(appointmentData) {
    const active = new Set();

    appointmentData.forEach(appointment => {
        const columns = buildColumns(appointment);
        columns.forEach((value, index) => {
            if (value !== null || value == "Notes") {
                active.add(index);
            }
        });
    });

    // preserve original column order
    return COLUMN_DEFINITIONS
        .map((_, index) => index)
        .filter(index => active.has(index));
}

async function blobToDataURL(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // process in chunks to avoid call stack limits on large files
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  const base64 = btoa(binary);
  return `data:${blob.type};base64,${base64}`;
}


async function convertDataToDocx(appointmentData) {
    const activeIndices = getActiveColumnIndices(appointmentData);
    const columnWidths = computeColumnWidths(activeIndices);

    const header = new TableRow({
        height: { value: HEADER_HEIGHT, rule: HeightRule.ATLEAST },
        children: activeIndices.map(index =>
            new TableCell({
                width: { size: columnWidths[index], type: WidthType.DXA },
                children: [new Paragraph({ text: COLUMN_DEFINITIONS[index].title })]
            })
        )
    });

    const rows = appointmentData.map(appointment => {
        const columns = buildColumns(appointment);
        return new TableRow({
            height: { value: MIN_ROW_HEIGHT, rule: HeightRule.ATLEAST },
            children: activeIndices.map(index =>
                new TableCell({
                    width: { size: columnWidths[index], type: WidthType.DXA },
                    children: [new Paragraph({ children: columns[index] || [] })]
                })
            )
        });
    });

    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    size: {
                        orientation: PAGE_ORIENTATION === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
                        width: PAGE_WIDTH_DXA,
                        height: PAGE_HEIGHT_DXA,
                    },
                    margin: {
                        top: PAGE_MARGIN,
                        bottom: PAGE_MARGIN,
                        left: PAGE_MARGIN,
                        right: PAGE_MARGIN,
                    },
                },
            },
            children: [
                new Table({
                    layout: TableLayoutType.FIXED,
                    width: { size: USABLE_WIDTH_DXA, type: WidthType.DXA }, // pin the table's total width too
                    rows: [header, ...rows]
                })
            ]
        }]
    });

    const blob = await Packer.toBlob(doc);
    const url = await blobToDataURL(blob);

    chrome.downloads.download({ url, filename: "Appointments.docx" });
}

// listen for messages from content.js / popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "convert") {
    convertDataToDocx(msg.data);
  }
  sendResponse({status:"Done"})
  return true
});