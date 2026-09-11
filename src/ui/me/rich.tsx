/**
 * The <b> in a written line, actually bold.
 *
 * The changelog is prose kept in a data file, and it marks the part that
 * matters with <b>. React escapes a string child, so without this those lines
 * print their own angle brackets on screen.
 *
 * Not dangerouslySetInnerHTML: the text is ours and safe today, but this is
 * exactly the kind of file that one day gets a line pasted into it from
 * somewhere else. One tag, parsed; anything else stays literal.
 */
export default function Rich({ text }: { text: string }) {
  const parts = text.split(/<b>|<\/b>/)
  return (
    <span>
      {parts.map((part, i) => (
        // splitting on a pair of delimiters puts the bold runs on odd indices
        i % 2 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>
      ))}
    </span>
  )
}
