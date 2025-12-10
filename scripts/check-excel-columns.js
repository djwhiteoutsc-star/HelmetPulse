const XLSX = require('xlsx');

const filePath = 'C:\\Users\\18036\\Desktop\\CardPulse\\Fanatics\\Inventory 12-8-25.xls';

const wb = XLSX.readFile(filePath);

for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log('\n=== Sheet:', name, '- Rows:', data.length, '===');

    if (data[0]) {
        console.log('Columns:', Object.keys(data[0]));
        console.log('\nSample row:');
        console.log(JSON.stringify(data[0], null, 2));

        // Check price column values
        let withRetail = 0;
        let withPrice = 0;
        let noPrice = 0;

        for (const row of data) {
            if (row.Retail) withRetail++;
            else if (row.Price) withPrice++;
            else noPrice++;
        }

        console.log('\nPrice stats:');
        console.log('  With Retail column:', withRetail);
        console.log('  With Price column:', withPrice);
        console.log('  No price:', noPrice);
    }
}
