import { IMPORT_SHEETS, type SchoolWorkbook } from "./schoolWorkbookValidation";

/** Read-only XLSX importer using the browser's native ZIP/XML APIs.
 * No workbook contents are uploaded until the school admin requests preview.
 * Supports Excel OOXML stored/deflate entries. Rejects oversized/encrypted files.
 */
const decoder = new TextDecoder("utf-8");
const MAX_FILE = 4 * 1024 * 1024;
const MAX_XML = 8 * 1024 * 1024;
const MAX_TOTAL_XML = 32 * 1024 * 1024;
const u16 = (d: DataView, offset: number) => d.getUint16(offset, true);
const u32 = (d: DataView, offset: number) => d.getUint32(offset, true);
const fail = (message: string): never => { throw new Error(message); };

async function filesFromZip(input: ArrayBuffer) {
  const view = new DataView(input);
  const bytes = new Uint8Array(input);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32(view,p) === 0x06054b50) { end = p; break; }
  }
  if (end < 0) fail("Not a valid XLSX/ZIP file.");
  const count = u16(view,end+10);
  if (count > 180) fail("Workbook contains too many ZIP entries.");
  let off = u32(view,end+16);
  const files = new Map<string, { method: number; offset: number; compressed: number; expanded: number }>();
  let totalExpanded = 0;
  for (let i=0;i<count;i++) {
    if (u32(view,off)!==0x02014b50) fail("Invalid XLSX central directory.");
    const method = u16(view,off+10), compressed=u32(view,off+20), expanded=u32(view,off+24);
    const nameLength=u16(view,off+28), extra=u16(view,off+30), comment=u16(view,off+32);
    const name=decoder.decode(bytes.subarray(off+46,off+46+nameLength));
    const at=u32(view,off+42);
    if (name.includes("..") || name.startsWith("/")) fail("Unsafe worksheet path.");
    if (expanded > MAX_XML) fail("Workbook has an oversized XML entry.");
    if (name.startsWith("xl/") || name==="[Content_Types].xml") {
      totalExpanded += expanded;
      if (totalExpanded > MAX_TOTAL_XML) fail("Workbook XML exceeds the 32 MB safety limit.");
      files.set(name,{method,offset:at,compressed,expanded});
    }
    off+=46+nameLength+extra+comment;
  }
  async function xml(path: string) {
    const entry=files.get(path);
    if (!entry) throw new Error(`Missing XLSX part: ${path}`);
    const p=entry.offset;
    if (u32(view,p)!==0x04034b50) fail(`Invalid local header for ${path}`);
    const start=p+30+u16(view,p+26)+u16(view,p+28);
    const raw=bytes.subarray(start,start+entry.compressed);
    let data: Uint8Array<ArrayBufferLike>;
    if (entry.method===0) data=raw;
    else if (entry.method===8) {
      const stream=new Blob([new Uint8Array(raw)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader=stream.getReader();
      const parts: Uint8Array[]=[];
      let size=0;
      while(true) {
        const {done,value}=await reader.read();
        if(done) break;
        size+=value.byteLength;
        if(size>MAX_XML) { await reader.cancel(); throw new Error(`Decompressed entry too large: ${path}`); }
        parts.push(value);
      }
      const combined=new Uint8Array(size);
      let position=0;
      for(const part of parts) {combined.set(part,position);position+=part.byteLength;}
      data=combined;
    } else throw new Error(`Unsupported ZIP compression method (${entry.method})`);
    const text=decoder.decode(data);
    const document=new DOMParser().parseFromString(text,"application/xml");
    if (document.querySelector("parsererror")) fail(`Invalid XML content: ${path}`);
    return document;
  }
  return xml;
}

const nodes=(parent: Document | Element, name: string): Element[] => Array.from(parent.getElementsByTagNameNS("*",name));
const child=(parent: Document | Element,name:string) => nodes(parent,name)[0];
const cellColumn=(coord: string) => {
  const letters=coord.match(/^[A-Z]+/)?.[0]??"A";
  let index=0;
  for(const c of letters) index=index*26+(c.charCodeAt(0)-64);
  return index-1;
};
const textOf=(el: Element | undefined) => el?.textContent ?? "";

export async function readSchoolWorkbook(file: File): Promise<SchoolWorkbook> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) fail("Choose an .xlsx workbook (not .xls, .csv or .xlsm).");
  if (file.size > MAX_FILE) fail("Workbook exceeds the 4 MB pilot import limit.");
  const xml=await filesFromZip(await file.arrayBuffer());
  const workbook=await xml("xl/workbook.xml");
  const relationships=await xml("xl/_rels/workbook.xml.rels");
  const rels=new Map<string,string>();
  for (const r of nodes(relationships,"Relationship")) {
    rels.set(r.getAttribute("Id")??"",r.getAttribute("Target")??"");
  }
  let shared:string[]=[];
  try {
    const strings=await xml("xl/sharedStrings.xml");
    shared=nodes(strings,"si").map(si=>nodes(si,"t").map(textOf).join(""));
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Missing XLSX part")) throw error;
  }
  const out:SchoolWorkbook={};
  for (const item of nodes(workbook,"sheet")) {
    const name=item.getAttribute("name")??"";
    if (!(IMPORT_SHEETS as readonly string[]).includes(name)) continue;
    const rid=item.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id")??"";
    const target=rels.get(rid);
    if (!target) throw new Error(`Missing worksheet relationship for ${name}`);
    const path=target.startsWith("/")?target.substring(1):target.startsWith("xl/")?target:`xl/${target.replace(/^\.\//,"")}`;
    const doc=await xml(path);
    const table=nodes(doc,"sheetData")[0];
    const excelRows=table?nodes(table,"row"):[];
    const values:string[][]=[];
    for (const row of excelRows) {
      const cells:string[]=[];
      for (const c of nodes(row,"c")) {
        const col=cellColumn(c.getAttribute("r")??"A1");
        const type=c.getAttribute("t");
        const value=type==="inlineStr"?nodes(c,"t").map(textOf).join(""):textOf(child(c,"v"));
        cells[col]=type==="s"?(shared[Number(value)]??""):value;
      }
      values.push(cells);
    }
    const headers=(values[0]??[]).map(h=>h?.trim()??"");
    if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) fail(`Duplicate headers in ${name}.`);
    out[name]=values.slice(1).filter(r=>r.some(v=>String(v??"").trim())).map(row=>
      Object.fromEntries(headers.map((head,i)=>[head,String(row[i]??"").trim()]).filter(([head])=>head))
    );
  }
  return out;
}
