import { seedNotes, seedCards } from "./seed.js";

const NOTES_KEY = "wr_notes";
const CARDS_KEY = "gap_cards";

function loadOrSeed(key, seedFn) {
  const raw = localStorage.getItem(key);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  const seeded = seedFn();
  localStorage.setItem(key, JSON.stringify(seeded));
  return seeded;
}

export const loadNotes = () => loadOrSeed(NOTES_KEY, seedNotes);
export const loadCards = () => loadOrSeed(CARDS_KEY, seedCards);

export const saveNotes = (notes) =>
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
export const saveCards = (cards) =>
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));

export function downloadJSON(filename, dataObj) {
  const blob = new Blob([JSON.stringify(dataObj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
