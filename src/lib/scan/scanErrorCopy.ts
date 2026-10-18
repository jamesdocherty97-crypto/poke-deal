export type ScanErrorCopy = {
  message: string;
  manual: boolean;
};

const UNREADABLE = "Couldn't read that photo. Try better light or fill the frame, or type it.";
const UNAVAILABLE = "Card scan is down for now. Type the card instead.";

/** Safe client copy for a scan HTTP status. Server body text is never accepted. */
export function scanErrorCopy(status: number): ScanErrorCopy {
  if (status === 502 || status === 503) return { message: UNAVAILABLE, manual: true };
  if (status === 422) return { message: UNREADABLE, manual: true };
  return { message: UNREADABLE, manual: true };
}
