import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx';
import JSZip from 'jszip';
import { NEXT_STEPS_STATIC_BLOCKS, NEXT_STEPS_DEFAULT_ORDER } from './reportConfig.js';

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F3864"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

async function injectTheme(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);

  zip.file('word/theme/theme1.xml', THEME_XML);

  const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
  const existingIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1], 10));
  const nextId = Math.max(...existingIds) + 1;
  const themeRel = `<Relationship Id="rId${nextId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`;
  const updatedRels = relsXml.replace('</Relationships>', `${themeRel}</Relationships>`);
  zip.file('word/_rels/document.xml.rels', updatedRels);

  const ctXml = await zip.file('[Content_Types].xml').async('string');
  if (!ctXml.includes('theme/theme1.xml')) {
    const themeOverride = '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
    const updatedCt = ctXml.replace('</Types>', `${themeOverride}</Types>`);
    zip.file('[Content_Types].xml', updatedCt);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Palette aligned with the Outlier report style guide:
// - Single ink colour (#1F1C2E) for ALL body, heading, and label text.
// - Status colours are reserved for in-cell score/severity badges where
//   the colour itself communicates information that ink alone cannot.
// - Box and card backgrounds use light pastels (NEVER grey) so the
//   exported document reads as a designed artefact, not a spreadsheet.
const COLOUR = {
  // Primary ink — used for every piece of body, heading and label text.
  text: '1F1C2E',

  // Brand block colour for solid-fill panels (verdict band, contact
  // footer, table headers). Not used as a *text* colour.
  navy: '1F3864',
  headerBg: '1F3864',
  headerText: 'FFFFFF',

  // Status text (deep, print-friendly). Used inside score/severity
  // cells where the colour communicates a data signal.
  scoreGreen: '548235',
  scoreAmber: 'BF8F00',
  scoreOrange: 'BF6900',
  scoreRed: 'C00000',

  // Status backgrounds (light pastels)
  scoreGreenBg: 'E2EFDA',
  scoreAmberBg: 'FFF2CC',
  scoreOrangeBg: 'FCE4D6',
  scoreRedBg: 'F4CCCC',
  scoreInfoBg: 'CFE2F3',

  // Alerts — pastel BG, deep border/title text, ink body for readability
  alertCriticalBg: 'F4CCCC',
  alertCriticalBorder: 'C00000',
  alertWarningBg: 'FFF2CC',
  alertWarningBorder: 'BF8F00',
  alertThresholdBg: 'CFE2F3',
  alertThresholdBorder: '1F3864',
  alertPositiveBg: 'E2EFDA',
  alertPositiveBorder: '548235',

  // Signal callout boxes — cream fill, accent border/title
  signalBg: 'FFF8E1',
  signalBorderBlue: '1F3864',
  signalBorderOrange: 'E69138',

  // Next-steps cards — soft cream/sand backgrounds, ink text.
  nextStepBg: 'FFF8E1',
  nextStepAccent: 'E69138',

  // Subtle row-stripe replaces the previous F2F2F2 grey. Pale cream
  // keeps the alternating-row hint without reading as a "spreadsheet
  // grey" box per the design document.
  rowStripe: 'FAF6EC',
  white: 'FFFFFF',

  // Quadrant matrix — only the active quadrant is colour-highlighted
  quadActiveBg: 'FFF2CC',
  quadInactiveBg: 'FFFFFF',

  // Verdict header band — navy block with white description text
  verdictBg: '1F3864',
  verdictPassText: '548235',
  verdictFailText: 'C00000',
  verdictDescText: 'FFFFFF',
  verdictLabelText: 'FFFFFF',

  // Sponsorship chain matrix — pastel cells with ink text
  chainGreen: 'D9EAD3',
  chainAmber: 'FFF2CC',
  chainOrange: 'FFF2CC',
  chainRed: 'F4CCCC',

  // Manager load bands — pastel cell BGs, status-colored percent
  loadSustainable: 'D9EAD3',
  loadStretched: 'FFF2CC',
  loadAtCapacity: 'FCE4D6',
  loadOverloaded: 'F4CCCC',
};

// Poppins is the brand typeface. Word will fall back to a sans-serif
// substitute when the font is not installed on the reader's machine.
const FONT = { body: 'Poppins', heading: 'Poppins' };
const BORDER_NONE = { style: BorderStyle.NONE, size: 0 };
const BORDER_BOTTOM_INK = { style: BorderStyle.SINGLE, size: 6, color: COLOUR.text };

function h1(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT.heading, size: 36, bold: true, color: COLOUR.text })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 120, after: 200 },
    border: { bottom: BORDER_BOTTOM_INK },
  });
}

function h2(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT.heading, size: 28, bold: true, color: COLOUR.text })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 140 },
  });
}

function h3(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT.heading, size: 24, bold: true, color: COLOUR.text })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 160, after: 100 },
  });
}

function body(text) {
  return new Paragraph({
    children: [new TextRun({ text: String(text || ''), font: FONT.body, size: 21, color: COLOUR.text })],
    spacing: { after: 140 },
  });
}

function bodyItalic(text) {
  return new Paragraph({
    children: [new TextRun({ text: String(text || ''), font: FONT.body, size: 21, italics: true, color: COLOUR.text })],
    spacing: { after: 140 },
  });
}

function bodySmallItalic(text) {
  return new Paragraph({
    children: [new TextRun({ text: String(text || ''), font: FONT.body, size: 18, italics: true, color: COLOUR.text })],
    spacing: { after: 100 },
  });
}

function bullet(text) {
  return new Paragraph({
    children: [new TextRun({ text: `•  ${String(text || '')}`, font: FONT.body, size: 21, color: COLOUR.text })],
    spacing: { after: 80 },
    indent: { left: convertInchesToTwip(0.3) },
  });
}

function metricRow(label, value) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE,
      insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
            children: [new Paragraph({
              children: [new TextRun({ text: label, font: FONT.body, size: 21, bold: true, color: COLOUR.text })],
            })],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
            children: [new Paragraph({
              children: [new TextRun({ text: String(value ?? '—'), font: FONT.body, size: 21, color: COLOUR.text })],
            })],
          }),
        ],
      }),
    ],
  });
}

function scoreStatusColour(status) {
  return status === 'HIGH' ? COLOUR.scoreGreen : COLOUR.scoreRed;
}

function scoreStatusBg(status) {
  return status === 'HIGH' ? COLOUR.scoreGreenBg : COLOUR.scoreRedBg;
}

function dimensionScoreColour(avg) {
  if (avg == null) return COLOUR.text;
  if (avg >= 3.5) return COLOUR.scoreGreen;
  if (avg >= 3.0) return COLOUR.scoreAmber;
  if (avg >= 2.5) return COLOUR.scoreOrange;
  return COLOUR.scoreRed;
}

function dimensionScoreBg(avg) {
  if (avg == null) return COLOUR.white;
  if (avg >= 3.5) return COLOUR.scoreGreenBg;
  if (avg >= 3.0) return COLOUR.scoreAmberBg;
  if (avg >= 2.5) return COLOUR.scoreOrangeBg;
  return COLOUR.scoreRedBg;
}

function styledCell(text, opts = {}) {
  const {
    bold = false, color = COLOUR.text, shading = null,
    font = FONT.body, size = 21, alignment = AlignmentType.LEFT,
    width = null, verticalAlign = null,
  } = opts;
  const cellOpts = {
    children: [new Paragraph({
      alignment,
      children: [new TextRun({ text: String(text ?? '—'), font, size, bold, color })],
    })],
  };
  if (shading) cellOpts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: shading };
  if (width) cellOpts.width = width;
  if (verticalAlign) cellOpts.verticalAlign = verticalAlign;
  return new TableCell(cellOpts);
}

function styledTable(headers, rows, opts = {}) {
  const { columnWidths = null } = opts;
  const headerCells = headers.map((header, idx) => {
    const cellOpts = {
      bold: true,
      color: COLOUR.headerText,
      shading: COLOUR.headerBg,
      size: 21,
    };
    if (columnWidths?.[idx]) cellOpts.width = columnWidths[idx];
    return styledCell(header, cellOpts);
  });
  // Alternating rows use a faint cream tint instead of grey so the
  // table reads as a designed component, not a spreadsheet.
  const dataRows = rows.map((row, rowIdx) =>
    new TableRow({
      children: row.map((cell, colIdx) => {
        if (typeof cell === 'object' && cell !== null && '_styled' in cell) {
          return styledCell(cell.text, {
            ...cell,
            shading: cell.shading || (rowIdx % 2 === 1 ? COLOUR.rowStripe : COLOUR.white),
          });
        }
        return styledCell(cell, {
          shading: rowIdx % 2 === 1 ? COLOUR.rowStripe : COLOUR.white,
          width: columnWidths?.[colIdx] || null,
        });
      }),
    })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headerCells, tableHeader: true }),
      ...dataRows,
    ],
  });
}

function scoreCardPair(leftLabel, leftScore, leftMax, leftStatus, rightLabel, rightScore, rightMax, rightStatus) {
  const leftColor = scoreStatusColour(leftStatus);
  const leftBg = scoreStatusBg(leftStatus);
  const rightColor = scoreStatusColour(rightStatus);
  const rightBg = scoreStatusBg(rightStatus);

  function cardCell(label, score, max, status, color, bg) {
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg },
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      children: [
        new Paragraph({
          children: [new TextRun({ text: label, font: FONT.heading, size: 22, bold: true, color: COLOUR.text })],
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: String(score), font: FONT.heading, size: 52, bold: true, color }),
            new TextRun({ text: ` / ${max}`, font: FONT.body, size: 24, color: COLOUR.text }),
          ],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `${status}  (threshold: ${Math.round(max * 0.7)}/${max})`, font: FONT.body, size: 20, bold: true, color })],
        }),
      ],
    });
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: COLOUR.text },
      bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE,
      insideHorizontal: BORDER_NONE, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: COLOUR.white },
    },
    rows: [new TableRow({
      children: [
        cardCell(leftLabel, leftScore, leftMax, leftStatus, leftColor, leftBg),
        cardCell(rightLabel, rightScore, rightMax, rightStatus, rightColor, rightBg),
      ],
    })],
  });
}

function singleScoreCard(label, score, max, status) {
  const color = scoreStatusColour(status);
  const bg = scoreStatusBg(status);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLOUR.text },
      bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE,
      insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE,
    },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, font: FONT.heading, size: 22, bold: true, color: COLOUR.text })],
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: String(score), font: FONT.heading, size: 52, bold: true, color }),
              new TextRun({ text: ` / ${max}`, font: FONT.body, size: 24, color: COLOUR.text }),
            ],
            spacing: { after: 40 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `${status}  (threshold: ${Math.round(max * 0.7)}/${max})`, font: FONT.body, size: 20, bold: true, color })],
          }),
        ],
      })],
    })],
  });
}

function verdictBox(verdictText, quadrantLabel) {
  const isPassed = verdictText === 'CLEARED FOR LAUNCH';
  const bg = COLOUR.verdictBg;
  const verdictColor = isPassed ? COLOUR.verdictPassText : COLOUR.verdictFailText;
  const descColor = COLOUR.verdictDescText;
  const labelColor = COLOUR.verdictLabelText;
  const quadColor = COLOUR.white;
  const desc = isPassed
    ? 'This organisation has the conditions required to proceed with the change programme.'
    : 'This organisation has the motivation to change. It does not yet have the sponsorship conditions to sustain it.';

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE,
      insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE,
    },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg },
          margins: { top: 140, bottom: 140, left: 200, right: 100 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: verdictText, font: FONT.heading, size: 28, bold: true, color: verdictColor })],
              spacing: { after: 80 },
            }),
            new Paragraph({
              children: [new TextRun({ text: desc, font: FONT.body, size: 20, color: descColor })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg },
          margins: { top: 140, bottom: 140, left: 100, right: 200 },
          verticalAlign: 'center',
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'Quadrant:', font: FONT.body, size: 18, color: labelColor })],
              spacing: { after: 40 },
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: quadrantLabel.toUpperCase(), font: FONT.heading, size: 22, bold: true, color: quadColor })],
            }),
          ],
        }),
      ],
    })],
  });
}

function quadrantMatrix(activeCode) {
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: COLOUR.text };
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  // Style guide: only the active quadrant is highlighted (pale yellow
  // fill); inactive quadrants stay white. All text is the brand ink
  // colour so the matrix reads as a single typographic unit.
  function qCell(code, label, desc, isHighlighted) {
    const bg = isHighlighted ? COLOUR.quadActiveBg : COLOUR.quadInactiveBg;
    return new TableCell({
      borders,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [
        new Paragraph({
          children: [
            ...(isHighlighted ? [new TextRun({ text: '\u25B6 ', font: FONT.body, size: 20, color: COLOUR.text })] : []),
            new TextRun({ text: label, font: FONT.heading, size: 20, bold: true, color: COLOUR.text }),
          ],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: desc, font: FONT.body, size: 17, italics: true, color: COLOUR.text })],
        }),
      ],
    });
  }

  const axisCell = (text) => new TableCell({
    borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
    verticalAlign: 'center',
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text, font: FONT.body, size: 17, italics: true, color: COLOUR.text })],
    })],
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE, insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
            children: [new Paragraph('')],
            width: { size: 10, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'LOW Sponsorship', font: FONT.body, size: 17, italics: true, color: COLOUR.text })],
            })],
          }),
          new TableCell({
            borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'HIGH Sponsorship', font: FONT.body, size: 17, italics: true, color: COLOUR.text })],
            })],
          }),
        ],
      }),
      new TableRow({
        children: [
          axisCell('HIGH\nAdoption'),
          qCell('motivated_lost', 'Motivated but Lost', "Org ready; leaders won't carry it", activeCode === 'motivated_lost'),
          qCell('optimal', 'Optimal', 'Proceed. Conditions are strong.', activeCode === 'optimal'),
        ],
      }),
      new TableRow({
        children: [
          axisCell('LOW\nAdoption'),
          qCell('high_risk', 'High Risk', 'Significant redesign required.', activeCode === 'high_risk'),
          qCell('capable_wary', 'Capable but Wary', 'Leaders credible; org not ready.', activeCode === 'capable_wary'),
        ],
      }),
    ],
  });
}

function signalBox(title, text, borderColor = COLOUR.signalBorderBlue) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER_NONE, bottom: BORDER_NONE, right: BORDER_NONE,
      left: { style: BorderStyle.SINGLE, size: 12, color: borderColor },
      insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE,
    },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOUR.signalBg },
        margins: { top: 120, bottom: 120, left: 180, right: 180 },
        borders: {
          top: BORDER_NONE, bottom: BORDER_NONE, right: BORDER_NONE, left: BORDER_NONE,
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: title, font: FONT.heading, size: 20, bold: true, color: COLOUR.text })],
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [new TextRun({ text: String(text || ''), font: FONT.body, size: 20, italics: true, color: COLOUR.text })],
          }),
        ],
      })],
    })],
  });
}

function alertBlock(severity, title, description) {
  // Style guide: pastel cell BG, deep status colour for the title border
  // (visual signal only), with all text in the brand ink colour for a
  // single typographic voice across the report.
  const config = {
    CRITICAL: { bg: COLOUR.alertCriticalBg, border: COLOUR.alertCriticalBorder },
    WARNING: { bg: COLOUR.alertWarningBg, border: COLOUR.alertWarningBorder },
    THRESHOLD: { bg: COLOUR.alertThresholdBg, border: COLOUR.alertThresholdBorder },
    POSITIVE: { bg: COLOUR.alertPositiveBg, border: COLOUR.alertPositiveBorder },
  };
  const style = config[severity] || config.THRESHOLD;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER_NONE, bottom: BORDER_NONE, right: BORDER_NONE,
      left: { style: BorderStyle.SINGLE, size: 12, color: style.border },
      insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE,
    },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: style.bg },
        margins: { top: 100, bottom: 100, left: 180, right: 180 },
        borders: { top: BORDER_NONE, bottom: BORDER_NONE, right: BORDER_NONE, left: BORDER_NONE },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: `${severity} — `, font: FONT.heading, size: 20, bold: true, color: COLOUR.text }),
              new TextRun({ text: title.toUpperCase(), font: FONT.heading, size: 20, bold: true, color: COLOUR.text }),
            ],
            spacing: { after: 50 },
          }),
          new Paragraph({
            children: [new TextRun({ text: description, font: FONT.body, size: 20, color: COLOUR.text })],
          }),
        ],
      })],
    })],
  });
}

function loadBandCards(distribution) {
  // Style guide: pastel BG per band, status-coloured percent number,
  // black title, medium-grey description. Mirrors the dimension table
  // ramp so the same severity reads consistently across the report.
  const bandConfig = {
    Sustainable: {
      bg: COLOUR.loadSustainable,
      percentColor: COLOUR.scoreGreen,
      desc: 'Genuine surplus capacity. Can act as active change sponsor.',
    },
    Stretched: {
      bg: COLOUR.loadStretched,
      percentColor: COLOUR.scoreAmber,
      desc: 'Managing, but at risk under additional change load.',
    },
    'At Capacity': {
      bg: COLOUR.loadAtCapacity,
      percentColor: COLOUR.scoreOrange,
      desc: 'Requires structured support and executive air cover.',
    },
    Overloaded: {
      bg: COLOUR.loadOverloaded,
      percentColor: COLOUR.scoreRed,
      desc: 'Risk amplifier. Do not launch without addressing load first.',
    },
  };

  const cells = distribution.map((band) => {
    const cfg = bandConfig[band.name] || bandConfig.Stretched;
    return new TableCell({
      width: { size: 25, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: cfg.bg },
      margins: { top: 100, bottom: 100, left: 100, right: 100 },
      children: [
        new Paragraph({
          children: [new TextRun({ text: `${band.percent}%`, font: FONT.heading, size: 36, bold: true, color: cfg.percentColor })],
          spacing: { after: 30 },
        }),
        new Paragraph({
          children: [new TextRun({ text: band.name, font: FONT.heading, size: 20, bold: true, color: COLOUR.text })],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [new TextRun({ text: cfg.desc, font: FONT.body, size: 16, color: COLOUR.text })],
        }),
      ],
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: COLOUR.text },
      bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE,
      insideHorizontal: BORDER_NONE,
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: COLOUR.white },
    },
    rows: [new TableRow({ children: cells })],
  });
}

function sponsorshipChainMatrix(distribution) {
  // Style guide: pastel cell BG indicates state severity, but all
  // numbers and labels are navy so the matrix reads as a single unit.
  const stateConfig = {
    'Chain Functioning': { bg: COLOUR.chainGreen },
    'Breaking at Manager Level': { bg: COLOUR.chainAmber },
    'Managers Resilient, Under-Supported': { bg: COLOUR.chainOrange },
    'Sponsorship Failed at Both Levels': { bg: COLOUR.chainRed },
  };

  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: COLOUR.text };
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const axisOpts = {
    borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
    verticalAlign: 'center',
  };

  function dataCell(name, percent) {
    const cfg = stateConfig[name] || { bg: COLOUR.white };
    return new TableCell({
      borders,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: cfg.bg },
      margins: { top: 80, bottom: 80, left: 80, right: 80 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `${percent}%`, font: FONT.heading, size: 28, bold: true, color: COLOUR.text })],
          spacing: { after: 30 },
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: name, font: FONT.body, size: 17, bold: true, color: COLOUR.text })],
        }),
      ],
    });
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE, insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE },
    rows: [
      new TableRow({
        children: [
          new TableCell({ ...axisOpts, children: [new Paragraph('')] }),
          new TableCell({
            ...axisOpts,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'LOW Received', font: FONT.body, size: 17, italics: true, color: COLOUR.text })],
            })],
          }),
          new TableCell({
            ...axisOpts,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'HIGH Received', font: FONT.body, size: 17, italics: true, color: COLOUR.text })],
            })],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            ...axisOpts,
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'HIGH\nCapacity', font: FONT.body, size: 17, italics: true, color: COLOUR.text })],
            })],
          }),
          dataCell('Breaking at Manager Level', distribution.find((s) => s.name === 'Breaking at Manager Level')?.percent || 0),
          dataCell('Chain Functioning', distribution.find((s) => s.name === 'Chain Functioning')?.percent || 0),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            ...axisOpts,
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'LOW\nCapacity', font: FONT.body, size: 17, italics: true, color: COLOUR.text })],
            })],
          }),
          dataCell('Sponsorship Failed at Both Levels', distribution.find((s) => s.name === 'Sponsorship Failed at Both Levels')?.percent || 0),
          dataCell('Managers Resilient, Under-Supported', distribution.find((s) => s.name === 'Managers Resilient, Under-Supported')?.percent || 0),
        ],
      }),
    ],
  });
}

function spacer(points = 120) {
  return new Paragraph({ spacing: { after: points } });
}

/**
 * Next-Step priority card. Each priority gets its own boxed cream
 * panel with a ring-badge priority number, the priority title, and the
 * recommended sub-actions as bulleted lines inside the same box. This
 * replaces the previous heading + flat bullet list which read as a
 * generic outline rather than a designed recommendation block.
 */
function nextStepCard({ priority, title, items }) {
  const accent = COLOUR.nextStepAccent;
  const badgeCell = new TableCell({
    width: { size: 12, type: WidthType.PERCENTAGE },
    verticalAlign: 'center',
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOUR.nextStepBg },
    margins: { top: 160, bottom: 160, left: 160, right: 80 },
    borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '0' + String(priority), font: FONT.heading, size: 56, bold: true, color: accent })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Priority', font: FONT.body, size: 16, bold: true, color: COLOUR.text, allCaps: true, characterSpacing: 40 })],
      }),
    ],
  });

  const bodyChildren = [
    new Paragraph({
      children: [new TextRun({ text: title, font: FONT.heading, size: 24, bold: true, color: COLOUR.text })],
      spacing: { after: 100 },
    }),
    ...items.map((line) => new Paragraph({
      children: [new TextRun({ text: `•  ${String(line || '')}`, font: FONT.body, size: 20, color: COLOUR.text })],
      spacing: { after: 60 },
      indent: { left: convertInchesToTwip(0.1) },
    })),
  ];

  const bodyCell = new TableCell({
    width: { size: 88, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOUR.nextStepBg },
    margins: { top: 160, bottom: 160, left: 80, right: 200 },
    borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE },
    children: bodyChildren,
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER_NONE, bottom: BORDER_NONE, right: BORDER_NONE,
      left: { style: BorderStyle.SINGLE, size: 18, color: accent },
      insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE,
    },
    rows: [new TableRow({ children: [badgeCell, bodyCell] })],
  });
}

// 40-point readiness score → status colour ramp. Mirrors the dimension
// table ramp so a single visual language carries through the report.
function readinessScoreColour(score, threshold = 28) {
  if (score == null) return COLOUR.text;
  if (score >= threshold) return COLOUR.scoreGreen;
  if (score >= threshold - 4) return COLOUR.scoreAmber;
  if (score >= threshold - 8) return COLOUR.scoreOrange;
  return COLOUR.scoreRed;
}

function readinessScoreBg(score, threshold = 28) {
  if (score == null) return COLOUR.white;
  if (score >= threshold) return COLOUR.scoreGreenBg;
  if (score >= threshold - 4) return COLOUR.scoreAmberBg;
  if (score >= threshold - 8) return COLOUR.scoreOrangeBg;
  return COLOUR.scoreRedBg;
}

const LOAD_BAND_BG = {
  Sustainable: COLOUR.loadSustainable,
  Stretched: COLOUR.loadStretched,
  'At Capacity': COLOUR.loadAtCapacity,
  Overloaded: COLOUR.loadOverloaded,
};

const QUADRANT_BG = {
  optimal: COLOUR.scoreGreenBg,
  motivated_lost: COLOUR.scoreAmberBg,
  capable_wary: COLOUR.scoreAmberBg,
  high_risk: COLOUR.scoreRedBg,
};

function teamBreakdownTable(teams) {
  const headers = ['Team', 'Responses', 'Adoption', 'Sponsorship', 'Quadrant', 'Manager Load'];
  const rows = teams.map((team) => {
    const adoptionText = team.adoption_score != null
      ? `${team.adoption_score} / 40 (${team.adoption_status})`
      : '—';
    const sponsorshipText = team.sponsorship_score != null
      ? `${team.sponsorship_score} / 40 (${team.sponsorship_status})`
      : '—';
    const responsesText = team.manager_count
      ? `${team.response_count} (${team.employee_count} staff · ${team.manager_count} mgr)`
      : `${team.response_count}`;

    return [
      { _styled: true, text: team.name, bold: true },
      { _styled: true, text: responsesText, alignment: AlignmentType.CENTER },
      {
        _styled: true,
        text: adoptionText,
        bold: true,
        color: readinessScoreColour(team.adoption_score),
        shading: readinessScoreBg(team.adoption_score),
        alignment: AlignmentType.CENTER,
      },
      {
        _styled: true,
        text: sponsorshipText,
        bold: true,
        color: readinessScoreColour(team.sponsorship_score),
        shading: readinessScoreBg(team.sponsorship_score),
        alignment: AlignmentType.CENTER,
      },
      {
        _styled: true,
        text: team.quadrant_label || '—',
        bold: true,
        color: COLOUR.text,
        shading: QUADRANT_BG[team.quadrant] || COLOUR.white,
        alignment: AlignmentType.CENTER,
      },
      {
        _styled: true,
        text: team.manager_load_band || '—',
        bold: true,
        color: COLOUR.text,
        shading: LOAD_BAND_BG[team.manager_load_band] || COLOUR.white,
        alignment: AlignmentType.CENTER,
      },
    ];
  });

  return styledTable(headers, rows, {
    columnWidths: [
      { size: 24, type: WidthType.PERCENTAGE },
      { size: 14, type: WidthType.PERCENTAGE },
      { size: 16, type: WidthType.PERCENTAGE },
      { size: 16, type: WidthType.PERCENTAGE },
      { size: 16, type: WidthType.PERCENTAGE },
      { size: 14, type: WidthType.PERCENTAGE },
    ],
  });
}

function dimensionStatusText(avg) {
  if (avg == null) return '—';
  if (avg >= 3.5) return 'Above threshold';
  if (avg >= 3.0) return 'Manageable but worth monitoring';
  return 'Below threshold — requires intervention';
}

/**
 * INF-07 cover-page brand override. If the report's organization sits
 * under a licensee, the licensee's brand displaces Outlier's navy on the
 * cover (logo, primary heading colour, "Prepared by …" line). The body
 * styling is unchanged — keeps the report layout consistent across
 * tenants while making attribution visible.
 */
const HEX_RE = /^#?[0-9a-f]{6}$/i;
function brandCoverColor(brand) {
  const raw = String(brand?.primaryColor || '').trim();
  if (!HEX_RE.test(raw)) return COLOUR.text;
  return raw.replace(/^#/, '').toUpperCase();
}

function isUsableLogoBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 0;
}

function logoParagraph(buffer, { width = 180, height = 56, after = 120 } = {}) {
  if (!isUsableLogoBuffer(buffer)) return null;
  try {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after },
      children: [
        new ImageRun({
          data: buffer,
          transformation: { width, height },
        }),
      ],
    });
  } catch (error) {
    console.error('Failed to embed logo in report:', error);
    return null;
  }
}

/**
 * Cover page logo lock-up. The Outlier (or licensee) brand logo always
 * sits at the top; the client's own company logo (when uploaded) is
 * stacked below it so the report visually identifies "for whom" as well
 * as "by whom" before the title even appears.
 */
function coverLogoStack({ outlierLogoBuffer, brandLogoBuffer, companyLogoBuffer }) {
  const paragraphs = [];
  // Prefer the licensee brand logo when one is configured, otherwise
  // fall back to the canonical Outlier logo.
  const topLogo = isUsableLogoBuffer(brandLogoBuffer) ? brandLogoBuffer : outlierLogoBuffer;
  const top = logoParagraph(topLogo, { width: 200, height: 60, after: companyLogoBuffer ? 120 : 240 });
  if (top) paragraphs.push(top);
  const company = logoParagraph(companyLogoBuffer, { width: 180, height: 60, after: 240 });
  if (company) paragraphs.push(company);
  return paragraphs;
}

function brandPreparedByParagraph(brand, coverColor) {
  const name = String(brand?.displayName || '').trim();
  if (!name) return null;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: `Prepared by ${name}`,
        font: FONT.body,
        size: 20,
        italics: true,
        color: coverColor,
      }),
    ],
  });
}

export async function buildReportDocx({
  reportData,
  signals,
  context = {},
  brand = null,
  outlierLogoBuffer = null,
  companyLogoBuffer = null,
}) {
  const adoptionDims = reportData.dimensions.employee.filter((d) => d.id.startsWith('1'));
  const sponsorshipDims = reportData.dimensions.employee.filter((d) => d.id.startsWith('2'));

  const dimTableRows = (dims, sectionLabel) =>
    dims.map((d) => [
      { _styled: true, text: `${d.id} — ${d.label}`, bold: true },
      sectionLabel,
      { _styled: true, text: `${d.avg ?? '—'} / 5.0`, bold: true, color: dimensionScoreColour(d.avg), shading: dimensionScoreBg(d.avg), alignment: AlignmentType.CENTER },
      dimensionStatusText(d.avg),
    ]);

  const mgrDimTableRows = reportData.dimensions.manager.map((d) => {
    const section = d.id.startsWith('1') ? 'Received' : 'Capacity';
    return [
      { _styled: true, text: `${d.id} — ${d.managerLabel}`, bold: true },
      section,
      { _styled: true, text: `${d.avg ?? '—'} / 5.0`, bold: true, color: dimensionScoreColour(d.avg), shading: dimensionScoreBg(d.avg), alignment: AlignmentType.CENTER },
      dimensionStatusText(d.avg),
    ];
  });

  const loadChainRows = reportData.manager.load_chain_matrix.map((row) => {
    // Style guide: row label sits on the load band's pastel BG.
    // Severity in the count cells is communicated by the cell shading
    // (green → yellow → orange → pink ramp); the count itself stays in
    // the brand ink colour so the matrix reads as a single unit, with
    // the highest-risk corner promoted to red text for emphasis.
    const loadConfig = {
      Sustainable: { shading: COLOUR.loadSustainable },
      Stretched: { shading: COLOUR.loadStretched },
      'At Capacity': { shading: COLOUR.loadAtCapacity },
      Overloaded: { shading: COLOUR.loadOverloaded },
    };
    const matrixSeverityStyle = (loadBand, chainState, count) => {
      if (count === 0) {
        return { shading: COLOUR.white, color: COLOUR.text, size: 22 };
      }
      if (loadBand === 'Sustainable' && chainState === 'Chain Functioning') {
        return { shading: COLOUR.chainGreen, color: COLOUR.text, size: 22 };
      }
      if (
        (loadBand === 'Sustainable' && chainState !== 'Chain Functioning')
        || (loadBand === 'Stretched' && chainState === 'Chain Functioning')
      ) {
        return { shading: COLOUR.chainGreen, color: COLOUR.text, size: 22 };
      }
      if (
        loadBand === 'Stretched'
        && (chainState === 'Breaking at Manager Level' || chainState === 'Managers Resilient, Under-Supported')
      ) {
        return { shading: COLOUR.scoreAmberBg, color: COLOUR.text, size: 22 };
      }
      if (
        (loadBand === 'Stretched' && chainState === 'Sponsorship Failed at Both Levels')
        || (loadBand === 'At Capacity'
          && (chainState === 'Breaking at Manager Level' || chainState === 'Managers Resilient, Under-Supported'))
      ) {
        return { shading: COLOUR.scoreOrangeBg, color: COLOUR.text, size: 22 };
      }
      if (
        (loadBand === 'At Capacity' && chainState === 'Sponsorship Failed at Both Levels')
        || (loadBand === 'Overloaded' && chainState === 'Managers Resilient, Under-Supported')
      ) {
        return { shading: COLOUR.scoreRedBg, color: COLOUR.text, size: 22 };
      }
      if (loadBand === 'Overloaded' && chainState === 'Sponsorship Failed at Both Levels') {
        return { shading: COLOUR.scoreRedBg, color: COLOUR.scoreRed, size: 28, bold: true };
      }
      return { shading: COLOUR.white, color: COLOUR.text, size: 22 };
    };
    return [
      {
        _styled: true,
        text: row.loadBand,
        bold: true,
        shading: loadConfig[row.loadBand]?.shading || COLOUR.white,
        color: COLOUR.text,
      },
      ...row.cells.map((cell) => {
        const style = matrixSeverityStyle(row.loadBand, cell.chainState, cell.count);
        return {
          _styled: true,
          text: String(cell.count),
          alignment: AlignmentType.CENTER,
          shading: style.shading,
          color: style.color,
          size: style.size,
          bold: Boolean(style.bold),
        };
      }),
    ];
  });

  const nextStepOrder = Array.isArray(signals?.nextStepsOrder) && signals.nextStepsOrder.length > 0
    ? signals.nextStepsOrder
    : NEXT_STEPS_DEFAULT_ORDER;

  const stageLabel = { pre: 'Pre-Change', mid: 'Mid-Change', post: 'Post-Change' }[reportData.stage] || reportData.stage;
  const reportDateFormatted = new Date(reportData.generated_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const responseRateText = reportData.totals.response_rate != null
    ? ` (${reportData.totals.response_rate}% response rate — ${reportData.totals.responses} of ${reportData.totals.invited} invited)`
    : '';

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT.body, size: 21, color: COLOUR.text },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.1),
              right: convertInchesToTwip(1.1),
            },
          },
        },
        children: [
          // ── Cover Page ────────────────────────────────────────────────
          // Logo lock-up: brand logo (or Outlier default) over the
          // client's company logo when one is on file.
          spacer((outlierLogoBuffer || brand?.logoBuffer || companyLogoBuffer) ? 240 : 600),
          ...coverLogoStack({
            outlierLogoBuffer,
            brandLogoBuffer: brand?.logoBuffer,
            companyLogoBuffer,
          }),
          new Paragraph({
            children: [new TextRun({ text: 'CHANGE READINESS ASSESSMENT', font: FONT.heading, size: 24, bold: true, color: brandCoverColor(brand), characterSpacing: 60 })],
            spacing: { after: 120 },
          }),
          new Paragraph({
            children: [new TextRun({ text: reportData.org.name, font: FONT.heading, size: 52, bold: true, color: brandCoverColor(brand) })],
            spacing: { after: 60 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: brandCoverColor(brand) } },
          }),
          ...(brandPreparedByParagraph(brand, brandCoverColor(brand)) ? [brandPreparedByParagraph(brand, brandCoverColor(brand))] : []),
          spacer(300),
          metricRow('Assessment Stage', stageLabel),
          metricRow('Report Date', reportDateFormatted),
          metricRow('Total Respondents', `${reportData.totals.responses} respondents${responseRateText}`),
          metricRow('Employees', `${reportData.totals.employee_count} (${reportData.totals.employee_pct}% of total)`),
          metricRow('Managers', `${reportData.totals.manager_count} (${reportData.totals.manager_pct}% of total)`),
          metricRow('Teams in Scope', reportData.totals.teams_in_scope),
          metricRow('Hierarchy Levels', reportData.org.hierarchy_levels || 'Not available'),
          ...(context.programme_name ? [metricRow('Programme', context.programme_name)] : []),
          ...(context.industry ? [metricRow('Industry / Sector', context.industry)] : []),
          ...(context.change_type ? [metricRow('Change Type', context.change_type)] : []),
          ...(context.programme_timeline ? [metricRow('Programme Timeline', context.programme_timeline)] : []),
          spacer(600),
          new Paragraph({
            children: [new TextRun({ text: 'Prepared by Rhythm Engine,', font: FONT.heading, size: 22, bold: true, color: COLOUR.text })],
            spacing: { after: 40 },
          }),
          new Paragraph({
            children: [new TextRun({ text: 'powered by The Outlier Group', font: FONT.body, size: 20, italics: true, color: COLOUR.text })],
            spacing: { after: 40 },
          }),
          spacer(300),
          new Paragraph({
            children: [new TextRun({ text: 'CONFIDENTIAL — FOR AUTHORISED RECIPIENTS ONLY', font: FONT.heading, size: 20, bold: true, color: COLOUR.scoreRed })],
          }),

          // ── Table of Contents ─────────────────────────────────────────
          new Paragraph({ pageBreakBefore: true }),
          h1('Table of Contents'),
          new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }),
          bodySmallItalic("Note: Right-click the table of contents and select 'Update Field' to refresh page numbers after any edits."),

          // ── Executive Summary ─────────────────────────────────────────
          new Paragraph({ pageBreakBefore: true }),
          h1('Executive Summary'),
          body(`This report presents the results of the Change Readiness Assessment conducted for ${reportData.org.name}. The assessment was completed by ${reportData.totals.responses} respondents across ${reportData.totals.teams_in_scope || 'multiple teams'}. The findings below reflect the ${stageLabel.toLowerCase()} baseline and should be read as diagnostic intelligence ahead of programme launch — not as a verdict on the organisation's capability.`),
          spacer(100),
          h2('Overall Readiness Verdict'),
          verdictBox(reportData.readiness.verdict, reportData.readiness.quadrant_label),
          spacer(160),
          h2('Key Scores at a Glance'),
          scoreCardPair(
            'Adoption Readiness', reportData.readiness.adoption_score, 40, reportData.readiness.adoption_status,
            'Sponsorship Credibility', reportData.readiness.sponsorship_score, 40, reportData.readiness.sponsorship_status,
          ),
          spacer(160),
          body(`The Adoption Readiness score of ${reportData.readiness.adoption_score}/40 indicates that the employee and manager population is, broadly, in a ${reportData.readiness.adoption_status === 'HIGH' ? 'capable and motivated' : 'fragile'} state ahead of this change. Scores ${reportData.readiness.adoption_status === 'HIGH' ? 'above' : 'below'} the 28-point threshold reflect ${reportData.readiness.adoption_status === 'HIGH' ? 'sufficient self-reported competence, capacity, and confidence in prior change delivery to proceed.' : 'gaps in self-reported competence, capacity, or confidence in prior change delivery.'}`),
          body(`The Sponsorship Credibility score of ${reportData.readiness.sponsorship_score}/40 ${reportData.readiness.sponsorship_status === 'HIGH' ? 'meets' : 'falls below'} the 28-point threshold. ${reportData.readiness.sponsorship_status === 'LOW' ? 'Employees and managers do not currently experience senior leaders as visibly modelling the change, communicating with sufficient honesty about its challenges, or creating the psychological safety needed to raise concerns.' : 'Employees and managers perceive leadership as credibly sponsoring the change.'}`),
          spacer(100),
          h2('Readiness Quadrant'),
          body('The quadrant classification combines both scores to produce a single strategic position.'),
          quadrantMatrix(reportData.readiness.quadrant),
          spacer(160),
          h2('Summary of Key Findings'),
          ...(signals.keyFindings || []).map((line) => bullet(line)),
          spacer(100),
          signalBox('Executive Overview', signals.executive, COLOUR.signalBorderBlue),

          // ── Adoption Readiness ────────────────────────────────────────
          new Paragraph({ pageBreakBefore: true }),
          h1('Adoption Readiness'),
          body('The Adoption Readiness score measures the degree to which employees and managers feel equipped, supported, and capable of absorbing significant change.'),
          spacer(80),
          singleScoreCard(
            'Adoption Readiness Score',
            reportData.readiness.adoption_score, 40, reportData.readiness.adoption_status,
          ),
          spacer(160),
          h2('Dimension Breakdown — Adoption'),
          body('Adoption Readiness is composed of four dimensions, each scored on a 2–10 scale (the sum of two questions per dimension), normalised here to a 1.0–5.0 average for comparability.'),
          styledTable(
            ['Dimension', 'Section', 'Avg Score', 'Status'],
            dimTableRows(adoptionDims, 'Adoption'),
            { columnWidths: [
              { size: 35, type: WidthType.PERCENTAGE },
              { size: 15, type: WidthType.PERCENTAGE },
              { size: 15, type: WidthType.PERCENTAGE },
              { size: 35, type: WidthType.PERCENTAGE },
            ]},
          ),
          spacer(120),
          signalBox('Adoption Readiness', signals.adoption, COLOUR.signalBorderBlue),

          // ── Sponsorship Credibility ───────────────────────────────────
          new Paragraph({ pageBreakBefore: true }),
          h1('Sponsorship Credibility'),
          body('The Sponsorship Credibility score measures the degree to which employees and managers experience senior leadership as visibly modelling change, communicating with honesty, walking the talk, and creating the psychological safety needed to raise concerns.'),
          spacer(80),
          singleScoreCard(
            'Sponsorship Credibility Score',
            reportData.readiness.sponsorship_score, 40, reportData.readiness.sponsorship_status,
          ),
          spacer(160),
          h2('Dimension Breakdown — Sponsorship'),
          styledTable(
            ['Dimension', 'Section', 'Avg Score', 'Status'],
            dimTableRows(sponsorshipDims, 'Sponsorship'),
            { columnWidths: [
              { size: 35, type: WidthType.PERCENTAGE },
              { size: 15, type: WidthType.PERCENTAGE },
              { size: 15, type: WidthType.PERCENTAGE },
              { size: 35, type: WidthType.PERCENTAGE },
            ]},
          ),
          spacer(120),
          signalBox('Sponsorship Credibility', signals.sponsorship, COLOUR.signalBorderOrange),

          // ── Manager Overview ──────────────────────────────────────────
          new Paragraph({ pageBreakBefore: true }),
          h1('Manager Overview'),
          h2('Manager Load'),
          body('Manager Load is derived from four survey questions assessing whether managers have the bandwidth, personal sustainability, and equipped capacity to lead their teams through change. It is a risk signal: a high proportion of managers in the At Capacity or Overloaded bands indicates that launching without structural support will amplify organisational risk.'),
          spacer(80),
          h3('Load Band Distribution'),
          loadBandCards(reportData.manager.load_distribution),
          spacer(160),
          signalBox('Manager Load', signals.managerLoad, COLOUR.signalBorderOrange),
          spacer(200),

          h2('Sponsorship Analysis'),
          body('This analysis disaggregates the Sponsorship Credibility score into two constructs with distinct intervention owners: what managers are receiving from senior leadership above, and whether managers have the conditions to sponsor their own teams below.'),
          spacer(80),
          h3('Sponsorship Sub-Score Overview'),
          scoreCardPair(
            'Sponsorship Received',
            reportData.manager.sponsorship_received_avg ?? '—', 20,
            (reportData.manager.sponsorship_received_avg ?? 0) >= 14 ? 'HIGH' : 'LOW',
            'Sponsorship Capacity',
            reportData.manager.sponsorship_capacity_avg ?? '—', 20,
            (reportData.manager.sponsorship_capacity_avg ?? 0) >= 14 ? 'HIGH' : 'LOW',
          ),
          spacer(160),

          h3('Sponsorship Chain Matrix'),
          body('The matrix below shows the distribution of managers across four chain states, derived by crossing Received and Capacity scores against the 14/20 threshold.'),
          sponsorshipChainMatrix(reportData.manager.sponsorship_chain_distribution),
          spacer(160),

          h3('Sponsorship Dimension Detail'),
          styledTable(
            ['Dimension', 'Section', 'Avg Score', 'Status'],
            mgrDimTableRows,
            { columnWidths: [
              { size: 35, type: WidthType.PERCENTAGE },
              { size: 15, type: WidthType.PERCENTAGE },
              { size: 15, type: WidthType.PERCENTAGE },
              { size: 35, type: WidthType.PERCENTAGE },
            ]},
          ),
          spacer(160),

          h3('Load Band × Chain State'),
          body('The cross-analysis below identifies the highest-risk sub-groups by combining each manager\'s load band with their chain state.'),
          styledTable(
            ['', ...reportData.manager.load_chain_matrix[0]?.cells.map((cell) => cell.chainState) || []],
            loadChainRows,
          ),
          spacer(120),
          signalBox('Sponsorship Chain Analysis', signals.chain, COLOUR.signalBorderOrange),

          // ── Team-Level Breakdown ──────────────────────────────────────
          ...((reportData.teams && reportData.teams.length > 0) ? [
            new Paragraph({ pageBreakBefore: true }),
            h1('Team-Level Breakdown'),
            body('The table below disaggregates the org-wide scores into a per-team view. Compare each team\'s Adoption and Sponsorship against the readiness threshold (28/40) and the org averages above to identify outliers requiring tailored intervention sequencing.'),
            spacer(80),
            teamBreakdownTable(reportData.teams),
            spacer(80),
            bodySmallItalic('Teams with fewer than 5 respondents should be interpreted with caution; small samples are sensitive to individual perspectives. Manager Load is shown only for teams whose lead manager completed the assessment.'),
            spacer(120),
            signalBox('Team-Level Breakdown', signals.teams, COLOUR.signalBorderOrange),
          ] : []),

          // ── Adoption Alerts ───────────────────────────────────────────
          new Paragraph({ pageBreakBefore: true }),
          h1('Adoption Alerts'),
          body('The following alerts were generated automatically based on scoring thresholds built into the assessment instrument. They are listed in priority order and represent the system\'s assessment of the most operationally significant findings requiring action before launch.'),
          spacer(80),
          ...(reportData.alerts.length > 0
            ? reportData.alerts.flatMap((alert) => [alertBlock(alert.severity, alert.title, alert.description), spacer(100)])
            : [alertBlock('POSITIVE', 'No Priority Alerts', 'No alerts were generated. All scores are within acceptable thresholds.'), spacer(100)]),

          // ── Next Steps & Recommended Support ──────────────────────────
          new Paragraph({ pageBreakBefore: true }),
          h1('Next Steps & Recommended Support'),
          body('The findings in this report point to a clear and sequenced set of interventions. The Outlier Group partners with organisations to design and deliver the specific interventions this assessment points to. The recommendations below reflect the priority sequence indicated by the data.'),
          spacer(120),
          ...nextStepOrder.flatMap((name, idx) => [
            nextStepCard({
              priority: idx + 1,
              title: name,
              items: NEXT_STEPS_STATIC_BLOCKS[name] || [],
            }),
            spacer(140),
          ]),

          // ── Contact Footer ────────────────────────────────────────────
          spacer(200),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE, insideHorizontal: BORDER_NONE, insideVertical: BORDER_NONE },
            rows: [new TableRow({
              children: [new TableCell({
                shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLOUR.text },
                margins: { top: 200, bottom: 200, left: 200, right: 200 },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: 'Ready to act on these findings?', font: FONT.heading, size: 26, bold: true, color: COLOUR.white })],
                    spacing: { after: 60 },
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: 'Contact The Outlier Group to discuss how we can support your programme.', font: FONT.body, size: 20, color: COLOUR.white })],
                    spacing: { after: 60 },
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({
                      text: reportData.org.report_contact || 'hello@theoutliergroup.com  |  www.theoutliergroup.com',
                      font: FONT.body, size: 20, bold: true, color: COLOUR.white,
                    })],
                  }),
                ],
              })],
            })],
          }),
          spacer(120),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              text: `This report is confidential and prepared exclusively for ${reportData.org.name}. The methodology, frameworks, and scoring logic are proprietary to The Outlier Group.`,
              font: FONT.body, size: 16, italics: true, color: COLOUR.text,
            })],
          }),
        ],
      },
    ],
  });

  const rawBuffer = await Packer.toBuffer(doc);
  return injectTheme(rawBuffer);
}
