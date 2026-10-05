/** Terminal-safe text for the human reporter. File names, paths and tool or
 * engine messages are untrusted: an ESC, OSC, C1 CSI (U+009B) or a bare \r in
 * one could clear the screen, plant a hidden link or overwrite a line. JSON
 * mode needs none of this, JSON.stringify escapes every control. */

const PLACEHOLDER = '�'
// C0 controls, DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g

/** One field on one line: tabs and line breaks become spaces, every other
 * control character (ESC included) becomes U+FFFD. */
export function sanitizeField(s: string): string {
  return s.replace(CONTROLS, (c) => (c === '\t' || c === '\n' || c === '\r' ? ' ' : PLACEHOLDER))
}

/** A multi-line block (a stack trace, a formats table): keeps \n and \t, turns
 * \r\n into \n and replaces every other control with U+FFFD. */
export function sanitizeText(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(CONTROLS, (c) => (c === '\n' || c === '\t' ? c : PLACEHOLDER))
}
