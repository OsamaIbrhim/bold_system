import { Injectable } from '@nestjs/common';
@Injectable()
export class NotificationsService {
  async sendEmail(to: string, subject: string, html: string) {
    // Nodemailer – configure SMTP in .env
    console.log(`[EMAIL] to ${to}: ${subject}`);
    return { sent: true, provider: 'smtp' };
  }
  async sendWhatsApp(to: string, message: string) {
    // WhatsApp Cloud API – set WHATSAPP_TOKEN
    console.log(`[WHATSAPP] to ${to}: ${message}`);
    return { sent: true, provider: 'whatsapp_cloud' };
  }
  async sendReport(report: any, channels: string[]) {
    const results = [];
    if (channels.includes('email')) results.push(await this.sendEmail('owner@bold.eg', 'Bold Daily Report', JSON.stringify(report)));
    if (channels.includes('whatsapp')) results.push(await this.sendWhatsApp('+20xxxxxxxxxx', 'تقرير Bold اليومي جاهز'));
    return results;
  }
}
