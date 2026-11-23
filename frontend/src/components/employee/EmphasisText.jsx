import { parseEmphasis } from '../../utils/surveyText.js';

/** Renders `**bold**` runs as <strong> without ever interpreting HTML. */
export default function EmphasisText({ text }) {
  return parseEmphasis(text).map((part, index) =>
    part.bold ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>
  );
}
