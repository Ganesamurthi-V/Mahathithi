const xlsx = require('xlsx');
const path = require('path');

const filePath = 'C:\\test file\\Manasa project\\Final_Mahaathithi (1).xlsx';
const workbook = xlsx.readFile(filePath);

console.log('Sheet Names:', workbook.SheetNames);

const firstSheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[firstSheetName];

const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
console.log('\n--- Headers ---');
console.log(data[0]);

console.log('\n--- First 3 Rows ---');
console.log(data.slice(1, 4));

console.log(`\nTotal rows in sheet: ${data.length}`);
