const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b](?:[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])))|\u001b\[[0-?]*[ -/]*[@-~]/g;

const NON_PRINTING_CONTROL_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export function formatTerminalOutput(value: string, fallback: string) {
  const text = value || fallback;

  return text
    .replace(ANSI_PATTERN, "")
    .replace(/\r\n?/g, "\n")
    .replace(NON_PRINTING_CONTROL_PATTERN, "");
}
