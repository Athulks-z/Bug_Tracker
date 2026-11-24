const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeClosingRemarks,
  validateClosureLinks,
  validateClosureUpload
} = require('./projectClosureValidation');

test('requires plain-text closing remarks and safely encodes stored HTML', () => {
  assert.equal(sanitizeClosingRemarks('<b>short</b>').valid, false);
  const result = sanitizeClosingRemarks('Finished <script>alert(1)</script> safely');
  assert.equal(result.valid, true);
  assert.equal(result.plainText, 'Finished safely');
  assert.equal(result.closingRemarksHtml, '<p>Finished safely</p>');
});

test('accepts only valid HTTP and HTTPS project links', () => {
  assert.equal(validateClosureLinks([{ url:'javascript:alert(1)' }]).valid, false);
  assert.equal(validateClosureLinks([{ url:'ftp://example.com/file' }]).valid, false);
  assert.equal(validateClosureLinks([{ url:'not a url' }]).valid, false);
  assert.deepEqual(validateClosureLinks([{ url:'https://example.com/path', label:'Docs' }]), {
    valid:true,
    links:[{ url:'https://example.com/path', label:'Docs' }]
  });
});

test('validates closure attachment extension, content, MIME, and size', () => {
  const pdf = Buffer.from('%PDF-1.7 safe sample');
  const encodedPdf = `data:application/pdf;base64,${pdf.toString('base64')}`;
  assert.equal(validateClosureUpload({
    filename:'report.pdf', data:encodedPdf, mime:'application/pdf', maxBytes:1024
  }).valid, true);
  assert.equal(validateClosureUpload({
    filename:'malware.exe', data:encodedPdf, mime:'application/pdf', maxBytes:1024
  }).valid, false);
  assert.equal(validateClosureUpload({
    filename:'report.pdf', data:encodedPdf, mime:'text/plain', maxBytes:1024
  }).valid, false);
  assert.equal(validateClosureUpload({
    filename:'report.pdf', data:encodedPdf, mime:'application/pdf', maxBytes:4
  }).valid, false);
  const oleDocument = `data:application/msword;base64,${Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]).toString('base64')}`;
  assert.equal(validateClosureUpload({
    filename:'report.doc',data:oleDocument,mime:'application/msword',maxBytes:1024
  }).valid,true);
  assert.equal(validateClosureUpload({
    filename:'bad\r\nname.pdf',data:encodedPdf,mime:'application/pdf',maxBytes:1024
  }).valid,false);
  const executable = `data:application/octet-stream;base64,${Buffer.from('MZ executable').toString('base64')}`;
  assert.equal(validateClosureUpload({
    filename:'report.dat', data:executable, mime:'application/octet-stream', maxBytes:1024
  }).valid, false);
});
