const sanitizeHtml = require('sanitize-html');

const BLOCKED_EXTENSIONS = new Set([
  'exe','bat','cmd','sh','msi','js','vbs','scr','com','cpl','jar','ps1','hta','reg','lnk','dll'
]);

function plainCustomType(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function sanitizeTaskDescription(value) {
  return sanitizeHtml(typeof value === 'string' ? value : '', {
    allowedTags: ['p','br','strong','b','em','i','u','h1','h2','h3','ol','ul','li','a','div','blockquote','s','code','pre','span'],
    allowedAttributes: {
      a:['href','title','target','rel'],
      '*':['style','align']
    },
    allowedStyles: {
      '*': { 'text-align': [/^(left|right|center|justify)$/] }
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target:'_blank', rel:'noopener noreferrer' }
      })
    }
  });
}

function validateAttachmentFilename(filename) {
  const originalName = String(filename || '').replace(/[\\\/]/g, '').trim();
  const parts = originalName.toLowerCase().split('.');
  const extension = parts.length > 1 ? parts.pop() : '';
  if (!originalName || !extension) return { valid:false, message:'A file with an extension is required' };
  if (BLOCKED_EXTENSIONS.has(extension) || parts.some((part) => BLOCKED_EXTENSIONS.has(part))) {
    return { valid:false, message:'This file extension is blocked' };
  }
  if (parts.length > 1) return { valid:false, message:'Double or multiple file extensions are not allowed' };
  return { valid:true, originalName, extension };
}

function startDateOrToday(value) {
  if (typeof value !== 'string' || !value.trim()) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function validateCustomTypeName(type, customTypeName) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const custom = plainCustomType(customTypeName);
  if (normalizedType === 'other') {
    return custom
      ? { valid:true, type:normalizedType, customTypeName:custom }
      : { valid:false, message:'Specify type is required for Other' };
  }
  if (String(customTypeName || '').trim()) {
    return { valid:false, message:'customTypeName must be empty unless Type is Other' };
  }
  return { valid:true, type:normalizedType, customTypeName:'' };
}

module.exports = {
  plainCustomType,
  sanitizeTaskDescription,
  validateAttachmentFilename,
  startDateOrToday,
  validateCustomTypeName
};
