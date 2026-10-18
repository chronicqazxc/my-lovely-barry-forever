// Timeline entries are stored as { year (title), date ('YYYY-MM-DD' or 'YYYY-MM' subtitle, optional), text }.
// The admin edits them as three boxes: Year (required), Month and Day (optional, a day needs a month).
// Older entries were typed as one line, so a year or date can sit in the wrong place. Tidy those on read
// (the site) and when the editor loads (admin); nothing is written back until the owner saves.
const pad = (n) => String(n).padStart(2, '0');

// Stored entry -> editor row { year, month, day, text } (all strings).
export function normalizeEntry(entry) {
  let year = String(entry.year ?? '').trim();
  let month = '';
  let day = '';
  let text = String(entry.text ?? '');

  const stored = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?-?$/.exec(String(entry.date ?? '').trim());
  if (stored) [, , month, day = ''] = stored;

  // "2011-08-20" or "2015-06" typed as the year -> year 2011 + month + day
  const typed = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(year);
  if (typed && !month) [, year, month, day = ''] = typed;

  // No year, but the text starts with one ("2014 KKC Korea Agility Championship — Silver ...") -> use it as the title
  if (!year) {
    const lead = /^((?:19|20)\d{2})\s*[-–—:·.]?\s+(\S[\s\S]*)$/.exec(text.trim());
    if (lead) {
      year = lead[1];
      text = lead[2];
    }
  }
  return { year, month: month ? String(Number(month)) : '', day: day ? String(Number(day)) : '', text };
}

// Editor row -> error messages per field ({} when valid). The year is required; month and day are optional.
export function validateEntry({ year = '', month = '', day = '' }) {
  const err = {};
  const [y, m, d] = [String(year).trim(), String(month).trim(), String(day).trim()];
  if (!y) err.year = 'Required';
  else if (!/^\d{4}$/.test(y) || Number(y) < 1900 || Number(y) > 2100) err.year = 'Use a 4-digit year, e.g. 2011';
  if (m && (!/^\d{1,2}$/.test(m) || Number(m) < 1 || Number(m) > 12)) err.month = 'Use 1 to 12';
  if (d) {
    if (!/^\d{1,2}$/.test(d) || Number(d) < 1) err.day = 'Use a valid day';
    else if (!m) err.day = 'Add a month first';
    else if (!err.month) {
      // Feb 29 only counts in a leap year; with no valid year, allow it so the year error shows alone.
      const max = new Date(Date.UTC(err.year ? 2000 : Number(y), Number(m), 0)).getUTCDate();
      if (Number(d) > max) err.day = `This month has ${max} days`;
    }
  }
  return err;
}

// Valid editor row -> stored entry.
export function toStored({ year, month, day, text }) {
  const [m, d] = [String(month).trim(), String(day).trim()];
  const date = m ? `${String(year).trim()}-${pad(Number(m))}${d ? `-${pad(Number(d))}` : ''}` : '';
  return { year: String(year).trim(), date, text: text.trim() };
}
