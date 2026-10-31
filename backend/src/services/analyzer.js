import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import Tesseract from 'tesseract.js';

/**
 * Normalizes text extracted from documents
 */
function clean(val) {
  if (val === undefined || val === null) return 'Not Found';
  const s = String(val).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return s.length > 0 ? s : 'Not Found';
}

/**
 * Parses combined survey string like "123/1A" or "123 / 1A" or "123-1A" into main & subdivision
 */
export function parseSurveyParts(raw) {
  if (!raw) return { main: 'Not Found', subdivision: 'Not Found' };
  const str = String(raw).trim();
  
  // Match standard Indian land record patterns: e.g. 123/1A, 123/1B, 123/2, 216/1, 102/3B1, 45-1A
  const slashMatch = str.match(/^([0-9]{1,7})\s*[\/]\s*([0-9A-Za-z_-]+(?:\/[0-9A-Za-z_-]+)?)$/);
  if (slashMatch) {
    return { main: slashMatch[1], subdivision: slashMatch[2] };
  }

  const hyphenMatch = str.match(/^([0-9]{1,7})\s*[-]\s*([0-9A-Za-z]+)$/);
  if (hyphenMatch) {
    return { main: hyphenMatch[1], subdivision: hyphenMatch[2] };
  }

  const pureNumber = str.match(/^([0-9]{1,7})$/);
  if (pureNumber) {
    return { main: pureNumber[1], subdivision: 'Not Found' };
  }

  // Fallback pattern if there is suffix
  const prefixMatch = str.match(/^([0-9]{1,7})([A-Za-z]+[0-9A-Za-z]*)$/);
  if (prefixMatch) {
    return { main: prefixMatch[1], subdivision: prefixMatch[2] };
  }

  return { main: str, subdivision: 'Not Found' };
}

/**
 * Extract contextual metadata (Village, Taluk, District, Patta, Plot, Extent) from a text block
 */
function extractContextFields(text) {
  const fields = {
    village: 'Not Found',
    taluk: 'Not Found',
    district: 'Not Found',
    plot_number: 'Not Found',
    extent: 'Not Found',
    patta_number: 'Not Found'
  };

  if (!text || typeof text !== 'string') return fields;

  // Village regex
  const vMatch = text.match(/(?:Village|Rev\.?\s*Village|Revenue\s*Village|Gramam)\s*[:\-–]\s*([A-Za-z0-9\s.,'-]{2,50})(?=[,\n;\r]|Taluk|District|Survey|S\.No|Plot|Patta|$)/i);
  if (vMatch && vMatch[1]) {
    const v = clean(vMatch[1]).replace(/^[.,\s]+|[.,\s]+$/g, '');
    if (v && v.length > 1 && !/^(and|or|of|in|to|the)$/i.test(v)) fields.village = v;
  }

  // Taluk regex
  const tMatch = text.match(/(?:Taluk|Taluka|Tahsil|Tehsil)\s*[:\-–]\s*([A-Za-z0-9\s.,'-]{2,50})(?=[,\n;\r]|District|Village|Survey|S\.No|Plot|Patta|$)/i);
  if (tMatch && tMatch[1]) {
    const t = clean(tMatch[1]).replace(/^[.,\s]+|[.,\s]+$/g, '');
    if (t && t.length > 1) fields.taluk = t;
  }

  // District regex
  const dMatch = text.match(/(?:District|Dist\.?)\s*[:\-–]\s*([A-Za-z0-9\s.,'-]{2,50})(?=[,\n;\r]|Taluk|Village|State|Survey|S\.No|Plot|Patta|$)/i);
  if (dMatch && dMatch[1]) {
    const d = clean(dMatch[1]).replace(/^[.,\s]+|[.,\s]+$/g, '');
    if (d && d.length > 1) fields.district = d;
  }

  // Patta Number regex
  const paMatch = text.match(/(?:Patta\s*(?:No|Number|Passbook)?|Khata\s*No\.?)\s*[:\-–]?\s*([A-Za-z0-9\/_-]+)/i);
  if (paMatch && paMatch[1]) {
    fields.patta_number = clean(paMatch[1]);
  }

  // Plot Number regex
  const plMatch = text.match(/(?:Plot\s*(?:No|Number)?)\s*[:\-–]?\s*([A-Za-z0-9\/_-]+)/i);
  if (plMatch && plMatch[1]) {
    fields.plot_number = clean(plMatch[1]);
  }

  // Land Extent regex
  const exMatch = text.match(/(?:Extent|Area|Land\s*Extent|Total\s*Extent)\s*[:\-–]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:acres?|cents?|hectares?|sq\.?\s*ft|sq\.?\s*m|gunthas?)?)/i);
  if (exMatch && exMatch[1]) {
    fields.extent = clean(exMatch[1]);
  }

  return fields;
}

/**
 * Parse text from PDF, OCR, or general text and extract survey numbers
 */
function extractFromText(rawText, sourceReference, sourceFileName, defaultContext = {}) {
  const results = [];
  if (!rawText || typeof rawText !== 'string') return results;

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const blockContext = extractContextFields(rawText);

  // Merge default context (from property or project) if available
  const context = {
    village: blockContext.village !== 'Not Found' ? blockContext.village : 'Not Found',
    taluk: blockContext.taluk !== 'Not Found' ? blockContext.taluk : 'Not Found',
    district: blockContext.district !== 'Not Found' ? blockContext.district : 'Not Found',
    plot_number: blockContext.plot_number !== 'Not Found' ? blockContext.plot_number : 'Not Found',
    extent: blockContext.extent !== 'Not Found' ? blockContext.extent : 'Not Found',
    patta_number: blockContext.patta_number !== 'Not Found' ? blockContext.patta_number : 'Not Found'
  };

  // Pattern A: Look for lines or text blocks with explicit Survey indicators
  // e.g., "Survey No: 123/1A, 123/1B and 124/2" or "Survey Nos: 123/1A, 123/1B, and 124/2"
  const surveyMarkerRegex = /(?:Survey\s*(?:Numbers|Number|Nos|No)?|Sy\.?\s*No\.?|R\.?\s*S\.?\s*No\.?|FMB\s*(?:S\.?\s*No\.?)?)\s*[:\-–]?\s*([0-9]{1,7}(?:\s*[\/\-]\s*[0-9A-Za-z_-]+)?(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s*;\s*)[0-9]{1,7}(?:\s*[\/\-]\s*[0-9A-Za-z_-]+)?)*)/gi;

  let match;
  while ((match = surveyMarkerRegex.exec(rawText)) !== null) {
    const listStr = match[1];
    const rawTokens = listStr.split(/(?:\s*,\s*(?:and\s+)?|\s+and\s+|;)/i).map(t => t.trim()).filter(Boolean);
    for (const token of rawTokens) {
      const parts = parseSurveyParts(token);
      if (parts.main && parts.main !== 'Not Found' && /^[0-9]+$/.test(parts.main)) {
        // Also check if line contains line-specific context
        const lineSnippet = rawText.slice(Math.max(0, match.index - 50), Math.min(rawText.length, match.index + match[0].length + 150));
        const lineCtx = extractContextFields(lineSnippet);

        results.push({
          survey_number: parts.main,
          subdivision: parts.subdivision,
          village: lineCtx.village !== 'Not Found' ? lineCtx.village : context.village,
          taluk: lineCtx.taluk !== 'Not Found' ? lineCtx.taluk : context.taluk,
          district: lineCtx.district !== 'Not Found' ? lineCtx.district : context.district,
          plot_number: lineCtx.plot_number !== 'Not Found' ? lineCtx.plot_number : context.plot_number,
          extent: lineCtx.extent !== 'Not Found' ? lineCtx.extent : context.extent,
          patta_number: lineCtx.patta_number !== 'Not Found' ? lineCtx.patta_number : context.patta_number,
          source_reference: sourceReference,
          source_file_name: sourceFileName,
          raw_extracted_text: clean(match[0]),
          requires_manual_review: parts.subdivision === 'Not Found' && /[\x00-\x1f]/.test(rawText)
        });
      }
    }
  }

  return results;
}

/**
 * Deduplicate extracted entries while strictly preserving distinct subdivision numbers
 * (e.g. 123/1A, 123/1B, and 123/2 are preserved as 3 distinct entries)
 */
function deduplicateSurveyEntries(entries) {
  const seen = new Map();
  const deduped = [];

  for (const entry of entries) {
    // Key preserves survey_number + subdivision + village + taluk + district + extent + source_reference
    const key = `${entry.survey_number}__${entry.subdivision}__${entry.village}__${entry.taluk}__${entry.district}__${entry.extent}__${entry.source_reference}`.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, true);
      deduped.push({
        ...entry,
        s_no: deduped.length + 1
      });
    }
  }

  return deduped;
}

/**
 * Calculate summary statistics according to explicit counting rules
 */
function calculateSummary(entries, originalFileName, uploaderName, status = 'Completed', errorMessage = null) {
  const totalEntries = entries.length;
  
  // Unique main survey numbers
  const uniqueMainSet = new Set();
  // Unique survey/subdivision combinations
  const uniqueComboSet = new Set();

  let successfullyExtracted = 0;
  let manualReviewCount = 0;

  const missingFields = {
    subdivision: 0,
    village: 0,
    taluk: 0,
    district: 0,
    plot_number: 0,
    extent: 0,
    patta_number: 0
  };

  for (const entry of entries) {
    if (entry.survey_number && entry.survey_number !== 'Not Found') {
      uniqueMainSet.add(entry.survey_number);
      uniqueComboSet.add(`${entry.survey_number}/${entry.subdivision}`);
      successfullyExtracted++;
    }

    if (entry.requires_manual_review) {
      manualReviewCount++;
    }

    if (entry.subdivision === 'Not Found') missingFields.subdivision++;
    if (entry.village === 'Not Found') missingFields.village++;
    if (entry.taluk === 'Not Found') missingFields.taluk++;
    if (entry.district === 'Not Found') missingFields.district++;
    if (entry.plot_number === 'Not Found') missingFields.plot_number++;
    if (entry.extent === 'Not Found') missingFields.extent++;
    if (entry.patta_number === 'Not Found') missingFields.patta_number++;
  }

  return {
    original_file_name: originalFileName,
    uploaded_by: uploaderName || 'Authorized User',
    upload_date: new Date().toISOString(),
    total_entries: totalEntries,
    total_survey_number_entries_identified: totalEntries,
    unique_main_survey_numbers: uniqueMainSet.size,
    total_unique_main_survey_numbers: uniqueMainSet.size,
    unique_survey_subdivision_combinations: uniqueComboSet.size,
    total_unique_survey_subdivision_combinations: uniqueComboSet.size,
    successfully_extracted: successfullyExtracted,
    number_of_records_successfully_extracted: successfullyExtracted,
    requires_manual_verification: manualReviewCount,
    number_of_records_requiring_manual_verification: manualReviewCount,
    missing_or_unreadable_fields: missingFields,
    processing_status: status,
    error_message: errorMessage
  };
}

/**
 * Parse Excel / CSV workbook
 */
function parseSpreadsheet(buffer, originalFileName, defaultContext = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const allEntries = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows || rows.length === 0) continue;

    // Detect header row index
    let headerIdx = -1;
    let colMap = {};

    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const row = rows[r].map(c => String(c).toLowerCase().trim());
      const hasSurveyCol = row.some(c => c.includes('survey') || c.includes('sy.no'));
      if (hasSurveyCol) {
        headerIdx = r;
        row.forEach((colName, idx) => {
          if (colName.includes('survey') || colName.includes('sy.no')) colMap.survey = idx;
          else if (colName.includes('subdivision') || colName.includes('sub division') || colName.includes('sub-division') || colName.includes('subdiv') || colName.includes('sub div')) colMap.subdivision = idx;
          else if (colName.includes('village')) colMap.village = idx;
          else if (colName.includes('taluk') || colName.includes('taluka')) colMap.taluk = idx;
          else if (colName.includes('district')) colMap.district = idx;
          else if (colName.includes('plot')) colMap.plot = idx;
          else if (colName.includes('extent') || colName.includes('area')) colMap.extent = idx;
          else if (colName.includes('patta') || colName.includes('khata')) colMap.patta = idx;
        });
        break;
      }
    }

    if (headerIdx !== -1 && colMap.survey !== undefined) {
      // Process data rows
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const rawSurvey = row[colMap.survey];
        if (!rawSurvey || String(rawSurvey).trim().length === 0) continue;

        let parts = parseSurveyParts(rawSurvey);
        if(!/^[0-9]{1,7}$/.test(parts.main))continue;
        let sub = colMap.subdivision !== undefined && row[colMap.subdivision] ? clean(row[colMap.subdivision]) : parts.subdivision;
        
        allEntries.push({
          survey_number: parts.main,
          subdivision: sub,
          village: colMap.village !== undefined && row[colMap.village] ? clean(row[colMap.village]) : 'Not Found',
          taluk: colMap.taluk !== undefined && row[colMap.taluk] ? clean(row[colMap.taluk]) : 'Not Found',
          district: colMap.district !== undefined && row[colMap.district] ? clean(row[colMap.district]) : 'Not Found',
          plot_number: colMap.plot !== undefined && row[colMap.plot] ? clean(row[colMap.plot]) : 'Not Found',
          extent: colMap.extent !== undefined && row[colMap.extent] ? clean(row[colMap.extent]) : 'Not Found',
          patta_number: colMap.patta !== undefined && row[colMap.patta] ? clean(row[colMap.patta]) : 'Not Found',
          source_reference: `Sheet: ${sheetName} (Row ${r + 1})`,
          source_file_name: originalFileName,
          raw_extracted_text: clean(row.join(' | ')),
          requires_manual_review: parts.main === 'Not Found'
        });
      }
    } else {
      // Fallback: convert sheet rows to text and extract
      const sheetText = rows.map(r => r.join(' ')).join('\n');
      const textEntries = extractFromText(sheetText, `Sheet: ${sheetName}`, originalFileName, defaultContext);
      allEntries.push(...textEntries);
    }
  }

  return allEntries;
}

/**
 * Main Document Analysis Function
 * Handles PDF, Excel, CSV, Images (OCR)
 */
export async function analyzeDocument({
  buffer,
  mimeType,
  originalFileName,
  property = {},
  uploaderName = 'Authorized User'
}) {
  const ext = (originalFileName.split('.').pop() || '').toLowerCase();
  let entries = [];
  let status = 'Completed';
  let errorMessage = null;

  const defaultContext = {};

  try {
    if (ext === 'pdf' || mimeType === 'application/pdf') {
      const parser = new PDFParse({ data: buffer });
      let textResult;
      try {textResult=await parser.getText();} finally {await parser.destroy();}
      
      if (textResult.pages && textResult.pages.length > 0) {
        for (const page of textResult.pages) {
          const pageRef = `Page ${page.num}`;
          const pageEntries = extractFromText(page.text, pageRef, originalFileName, defaultContext);
          entries.push(...pageEntries);
        }
      } else if (textResult.text) {
        entries = extractFromText(textResult.text, 'Page 1', originalFileName, defaultContext);
      }

      // If PDF has no extractable text layer, it might be scanned
      if (entries.length === 0 && (!textResult.text || textResult.text.trim().length < 20)) {
        if (entries.length === 0) {
          status = 'Completed';
          errorMessage = 'The document appears to be a scanned or image-based PDF. No readable text could be identified automatically; please review manually.';
        }
      }
    } else if (['xlsx', 'xls', 'csv'].includes(ext) || mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') {
      entries = parseSpreadsheet(buffer, originalFileName, defaultContext);
    } else if (['jpg', 'jpeg', 'png'].includes(ext) || mimeType.startsWith('image/')) {
      try {
        const ocrRes = await Tesseract.recognize(buffer, 'eng');
        const ocrText = ocrRes?.data?.text || '';
        if (ocrText.trim().length > 0) {
          entries = extractFromText(ocrText, 'Image OCR', originalFileName, defaultContext);
          // Mark OCR-derived records for manual review
          entries.forEach(e => e.requires_manual_review = true);
        } else {
          errorMessage = 'No readable text could be identified from the uploaded image.';
        }
      } catch (ocrErr) {
        errorMessage = `OCR processing failed: ${ocrErr.message}`;
        status = 'Failed';
      }
    } else {
      errorMessage = `Unsupported document format for analysis: ${ext}`;
      status = 'Failed';
    }
  } catch (err) {
    console.error('[Document Analyzer] Error analyzing document:', err);
    status = 'Failed';
    errorMessage = err.message || 'An error occurred while analyzing the document.';
  }

  // Deduplicate while preserving distinct subdivision numbers
  const dedupedEntries = deduplicateSurveyEntries(entries);

  // If no survey numbers were extracted and there wasn't a fatal error, still provide clean summary
  const summary = calculateSummary(dedupedEntries, originalFileName, uploaderName, status, errorMessage);

  return {
    status,
    errorMessage,
    summary,
    entries: dedupedEntries
  };
}
