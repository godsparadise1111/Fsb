import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PDFDocument = require('pdfkit');
import { existsSync } from 'node:fs';
import { ReportBuilderService } from './report-builder.service';

type ReportResult = Awaited<ReturnType<ReportBuilderService['execute']>>;

@Injectable()
export class ReportBuilderExportsService {
  async excel(result: ReportResult): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'F-S BPMS';
    workbook.created = new Date();
    workbook.subject = 'گزارش پویا';
    const sheet = workbook.addWorksheet('گزارش', { views: [{ rightToLeft: true }] });
    sheet.columns = [
      { header: result.groupLabel ?? 'گروه', key: 'dimension', width: 36 },
      { header: result.measureLabel, key: 'value', width: 22 },
    ];
    sheet.addRows(result.rows.map(row => ({ dimension: row.dimension ?? 'همه', value: row.value })));
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: 'B1' };
    sheet.getColumn(2).numFmt = '#,##0.00';
    sheet.getCell('D1').value = 'از تاریخ';
    sheet.getCell('E1').value = result.period.from;
    sheet.getCell('D2').value = 'تا تاریخ';
    sheet.getCell('E2').value = result.period.to;
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async pdf(result: ReportResult): Promise<Buffer> {
    const fontPath = process.env.FSB_PDF_FONT_PATH ?? '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf';
    if (!existsSync(fontPath)) {
      throw new ServiceUnavailableException('فونت فارسی PDF پیدا نشد؛ مسیر FSB_PDF_FONT_PATH را به فایل TTF فارسی معتبر تنظیم کنید');
    }
    return new Promise<Buffer>((resolve, reject) => {
      const document = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
      const chunks: Buffer[] = [];
      document.on('data', chunk => chunks.push(Buffer.from(chunk)));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.registerFont('Farsi', fontPath);
      document.font('Farsi').fontSize(16).text('گزارش پویا', { align: 'right' });
      document.moveDown(0.5).fontSize(9)
        .text('از تاریخ: ' + result.period.from.slice(0, 10) + '    تا تاریخ: ' + result.period.to.slice(0, 10), { align: 'right' })
        .moveDown();
      const right = document.page.width - document.page.margins.right;
      const left = document.page.margins.left;
      const width = right - left;
      const rowHeight = 24;
      const drawRow = (a: string, b: string, header = false) => {
        if (document.y + rowHeight > document.page.height - document.page.margins.bottom) document.addPage();
        const y = document.y;
        if (header) document.save().fillColor('#e8edf5').rect(left, y, width, rowHeight).fill().restore();
        document.font('Farsi').fontSize(header ? 10 : 9).fillColor('#172033');
        document.text(a, left + 8, y + 6, { width: width * 0.68, align: 'right', lineBreak: false });
        document.text(b, left + width * 0.70, y + 6, { width: width * 0.28, align: 'right', lineBreak: false });
        document.y = y + rowHeight;
      };
      drawRow(result.groupLabel ?? 'گروه', result.measureLabel, true);
      for (const row of result.rows) drawRow(String(row.dimension ?? 'همه'), row.value === null ? '—' : Number(row.value).toLocaleString('en-US'));
      document.end();
    });
  }
}
