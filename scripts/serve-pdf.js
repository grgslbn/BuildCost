const http = require('http');
const fs = require('fs');
const path = require('path');
const pdfPath = String.raw`C:\Users\tieme\Mijn Drive\M²Value\field\SELECTION\selectie building\25-54207700055VerzamelPDF_20260501_0231.pdf`;
const server = http.createServer((req, res) => {
  if (req.url === '/plan.pdf') {
    const stat = fs.statSync(pdfPath);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': stat.size });
    fs.createReadStream(pdfPath).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><iframe src="/plan.pdf" width="100%" height="100%" style="position:fixed;top:0;left:0;border:none;"></iframe></body></html>');
  }
});
server.listen(8765, () => console.log('Server on http://localhost:8765'));
