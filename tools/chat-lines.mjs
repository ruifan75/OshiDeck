// Chat exports are LF-delimited JSON, not Unicode-delimited text. U+2028 and
// U+2029 are legal inside JSON strings; readline also splits on those on some
// Node versions, turning one valid message into several invalid records.
import { createReadStream } from "node:fs";

export async function* chatLines(file) {
  let pending = "";
  for await (const chunk of createReadStream(file, { encoding: "utf8" })) {
    pending += chunk;
    let start = 0;
    let end;
    while ((end = pending.indexOf("\n", start)) >= 0) {
      yield pending.slice(start, end);
      start = end + 1;
    }
    pending = pending.slice(start);
  }
  if (pending) yield pending;
}
