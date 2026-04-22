import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { NEXT_STEPS_STATIC_BLOCKS, NEXT_STEPS_DEFAULT_ORDER } from './reportConfig.js';

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { after: 220 } });
}

function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { after: 180 } });
}

function body(text) {
  return new Paragraph({ children: [new TextRun(String(text || ''))], spacing: { after: 160 } });
}

function metric(label, value) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun(String(value ?? '—')),
    ],
    spacing: { after: 120 },
  });
}

function simpleTable(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map((header) =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: header, bold: true })] })],
          })
        ),
      }),
      ...rows.map((row) =>
        new TableRow({
          children: row.map((value) =>
            new TableCell({
              children: [new Paragraph(String(value ?? '—'))],
            })
          ),
        })
      ),
    ],
  });
}

export async function buildReportDocx({ reportData, signals }) {
  const dimEmployeeRows = reportData.dimensions.employee.map((dimension) => [
    `${dimension.id} ${dimension.label}`,
    `${dimension.avg ?? '—'}/5.0`,
  ]);
  const dimManagerRows = reportData.dimensions.manager.map((dimension) => [
    `${dimension.id} ${dimension.managerLabel}`,
    `${dimension.avg ?? '—'}/5.0`,
  ]);
  const loadRows = reportData.manager.load_distribution.map((band) => [
    band.name,
    `${band.percent}%`,
    String(band.count),
  ]);
  const chainRows = reportData.manager.sponsorship_chain_distribution.map((state) => [
    state.name,
    `${state.percent}%`,
    String(state.count),
  ]);
  const alertRows = reportData.alerts.map((alert) => [alert.severity, alert.title, alert.description]);
  const nextStepOrder = Array.isArray(signals?.nextStepsOrder) && signals.nextStepsOrder.length > 0
    ? signals.nextStepsOrder
    : NEXT_STEPS_DEFAULT_ORDER;

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: 'CHANGE READINESS ASSESSMENT',
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
          }),
          new Paragraph({
            text: reportData.org.name,
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
          }),
          metric('Assessment Stage', reportData.stage.toUpperCase()),
          metric('Report Date', new Date(reportData.generated_at).toLocaleDateString('en-GB')),
          metric('Total Respondents', reportData.totals.responses),
          metric('Employees', `${reportData.totals.employee_count} (${reportData.totals.employee_pct}%)`),
          metric('Managers', `${reportData.totals.manager_count} (${reportData.totals.manager_pct}%)`),
          metric('Teams in Scope', reportData.totals.teams_in_scope),
          metric('Hierarchy Levels', reportData.org.hierarchy_levels || 'Not available'),
          body('Prepared by The Outlier Group'),
          body('CONFIDENTIAL — For authorised recipients only'),
          new Paragraph({ pageBreakBefore: true }),
          h1('Table of Contents'),
          new TableOfContents('Contents', {
            hyperlink: true,
            headingStyleRange: '1-3',
          }),
          new Paragraph({ pageBreakBefore: true }),
          h1('Executive Summary'),
          metric('Overall Readiness Verdict', reportData.readiness.verdict),
          metric('Quadrant', reportData.readiness.quadrant_label),
          metric('Adoption Readiness', `${reportData.readiness.adoption_score} / 40`),
          metric('Sponsorship Credibility', `${reportData.readiness.sponsorship_score} / 40`),
          h2('Summary of Key Findings'),
          ...(signals.keyFindings || []).map((line) => body(`• ${line}`)),
          h2('AI Signal — Executive Overview'),
          body(signals.executive),
          new Paragraph({ pageBreakBefore: true }),
          h1('Adoption Readiness'),
          metric('Score', `${reportData.readiness.adoption_score} / 40 (${reportData.readiness.adoption_status})`),
          simpleTable(['Dimension', 'Average'], dimEmployeeRows.filter((row) => row[0].startsWith('1'))),
          h2('AI Signal — Adoption Readiness'),
          body(signals.adoption),
          new Paragraph({ pageBreakBefore: true }),
          h1('Sponsorship Credibility'),
          metric('Score', `${reportData.readiness.sponsorship_score} / 40 (${reportData.readiness.sponsorship_status})`),
          simpleTable(['Dimension', 'Average'], dimEmployeeRows.filter((row) => row[0].startsWith('2'))),
          h2('AI Signal — Sponsorship Credibility'),
          body(signals.sponsorship),
          new Paragraph({ pageBreakBefore: true }),
          h1('Manager Overview'),
          h2('Load Band Distribution'),
          simpleTable(['Band', 'Percent', 'Count'], loadRows),
          h2('Sponsorship Chain Distribution'),
          simpleTable(['Chain State', 'Percent', 'Count'], chainRows),
          h2('Manager Dimension Detail'),
          simpleTable(['Dimension', 'Average'], dimManagerRows),
          h2('Load x Chain Matrix'),
          simpleTable(
            ['Load Band', ...reportData.manager.load_chain_matrix[0]?.cells.map((cell) => cell.chainState) || []],
            reportData.manager.load_chain_matrix.map((row) => [
              row.loadBand,
              ...row.cells.map((cell) => cell.count),
            ])
          ),
          h2('AI Signal — Manager Load'),
          body(signals.managerLoad),
          h2('AI Signal — Sponsorship Chain'),
          body(signals.chain),
          new Paragraph({ pageBreakBefore: true }),
          h1('Adoption Alerts'),
          simpleTable(['Severity', 'Alert', 'Description'], alertRows.length ? alertRows : [['REVIEW', 'No alerts', 'No priority alerts were generated.']]),
          new Paragraph({ pageBreakBefore: true }),
          h1('Next Steps'),
          ...nextStepOrder.flatMap((name, idx) => {
            const bullets = NEXT_STEPS_STATIC_BLOCKS[name] || [];
            return [
              h2(`Priority ${idx + 1} — ${name}`),
              ...bullets.map((line) => body(`• ${line}`)),
            ];
          }),
          body(`Contact: ${reportData.org.report_contact || 'hello@theoutliergroup.com | www.theoutliergroup.com'}`),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
