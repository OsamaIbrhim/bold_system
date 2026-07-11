import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import axios from 'axios';

@Injectable()
export class NotificationsService {
  private mailer: nodemailer.Transporter | null = null;

  private getMailer() {
    if (this.mailer) return this.mailer;
    const host = process.env.SMTP_HOST;
    if (!host) return null;
    this.mailer = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
    return this.mailer;
  }

  async sendEmail(to: string, subject: string, html: string, text?: string) {
    const mailer = this.getMailer();
    if (!mailer) {
      console.log(`[EMAIL STUB] to ${to}: ${subject}`);
      return { sent: false, reason: 'SMTP not configured – set SMTP_HOST in .env', provider: 'stub' };
    }
    try {
      const info = await mailer.sendMail({
        from: process.env.SMTP_FROM || '"Bold POS" <noreply@bold.eg>',
        to, subject,
        text: text || subject,
        html,
      });
      return { sent: true, messageId: info.messageId, provider: 'smtp' };
    } catch (e: any) {
      console.error('Email send failed', e.message);
      return { sent: false, error: e.message };
    }
  }

  async sendWhatsApp(to: string, message: string) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    if (!token || !phoneId) {
      console.log(`[WHATSAPP STUB] to ${to}: ${message}`);
      return { sent: false, reason: 'WhatsApp Cloud API not configured – set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in .env', provider: 'stub' };
    }
    try {
      // WhatsApp Cloud API – https://developers.facebook.com/docs/whatsapp/cloud-api/
      const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
      const res = await axios.post(url, {
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''), // digits only
        type: 'text',
        text: { body: message }
      }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }});
      return { sent: true, id: res.data.messages?.[0]?.id, provider: 'whatsapp_cloud' };
    } catch (e: any) {
      console.error('WhatsApp send failed', e.response?.data || e.message);
      return { sent: false, error: e.response?.data || e.message };
    }
  }

  async sendReport(report: any, channels: string[]) {
    const summary = `تقرير Bold\nالمبيعات: ${Number(report.total_sales||0).toFixed(2)} ج\nالتكلفة: ${Number(report.total_cost||0).toFixed(2)} ج\nالربح: ${Number(report.profit||0).toFixed(2)} ج\nالفواتير: ${report.count||0}`;
    const html = `
      <div dir="rtl" style="font-family:Cairo,Arial,sans-serif">
      <h2>تقرير Bold اليومي</h2>
      <p>المبيعات: <b>${Number(report.total_sales||0).toFixed(2)} ج</b></p>
      <p>التكلفة: ${Number(report.total_cost||0).toFixed(2)} ج</p>
      <p>الربح: <b>${Number(report.total_profit||report.profit||0).toFixed(2)} ج</b></p>
      <p>عدد الفواتير: ${report.count||0}</p>
      <hr><small>Bold POS – ${new Date().toLocaleString('ar-EG')}</small>
      </div>`;
    const results:any = {};
    if (channels.includes('email')) {
      const to = process.env.REPORT_EMAIL_TO || 'owner@bold.eg';
      results.email = await this.sendEmail(to, 'تقرير Bold اليومي', html, summary);
    }
    if (channels.includes('whatsapp')) {
      const to = process.env.REPORT_WHATSAPP_TO || '+200100000000';
      results.whatsapp = await this.sendWhatsApp(to, summary);
    }
    return results;
  }
}
