/** Script detection also keeps generated Telugu/Hindi answers on the right voice route. */
export function speechLanguage(text: string): string {
  if (/[\u0c00-\u0c7f]/u.test(text) || /\btelugu\b/i.test(text)) {
    return "te-IN";
  }
  if (/[\u0b80-\u0bff]/u.test(text) || /\btamil\b/i.test(text)) {
    return "ta-IN";
  }
  if (/[\u0c80-\u0cff]/u.test(text) || /\bkannada\b/i.test(text)) {
    return "kn-IN";
  }
  if (/[\u0d00-\u0d7f]/u.test(text) || /\bmalayalam\b/i.test(text)) {
    return "ml-IN";
  }
  if (/[\u0980-\u09ff]/u.test(text) || /\bbengali\b/i.test(text)) {
    return "bn-IN";
  }
  if (/[\u0a80-\u0aff]/u.test(text) || /\bgujarati\b/i.test(text)) {
    return "gu-IN";
  }
  if (/[\u0a00-\u0a7f]/u.test(text) || /\bpunjabi\b/i.test(text)) {
    return "pa-IN";
  }
  if (/\bmarathi\b/i.test(text)) {
    return "mr-IN";
  }
  if (/[\u0900-\u097f]/u.test(text) || /\bhindi\b/i.test(text)) {
    return "hi-IN";
  }
  return "en-IN";
}
