import nodemailer from 'nodemailer';

export function createMailer(config) {
  const { smtp } = config;
  if (!smtp || !smtp.enabled) {
    return {
      enabled: false,
      async sendMail() {
        return { skipped: true };
      },
      async sendReviewAlert() {
        return { skipped: true };
      },
      async sendReportEmail() {
        return { skipped: true };
      },
      async sendUploadNotification() {
        return { skipped: true };
      }
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    auth: {
      user: smtp.user,
      pass: smtp.pass
    }
  });

  async function sendMail({ to, subject, html, text, attachments = [] }) {
    try {
      const info = await transporter.sendMail({
        from: smtp.from,
        to,
        subject,
        text,
        html,
        attachments
      });
      console.log(`[Mailer] Email delivered to ${to} (${info.messageId})`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[Mailer] Delivery failed to ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  async function sendReviewAlert({ property, categoryName, status, reason, remarks, reviewerName }) {
    const isRejected = status === 'Rejected';
    const isVerified = status === 'Verified';
    const subject = isRejected
      ? `[DNAssets] Action Required: Replacement Requested - Survey ${property.survey_number}`
      : `[DNAssets] Document Verified: ${categoryName} - Survey ${property.survey_number}`;

    const color = isRejected ? '#dc2626' : (isVerified ? '#16a34a' : '#2563eb');
    const badgeText = isRejected ? 'REPLACEMENT REQUESTED' : (isVerified ? 'VERIFIED' : status.toUpperCase());

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="margin-bottom: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 10px;">
          <h2 style="margin: 0; color: #0f172a; font-size: 20px;">DNAssets <span style="font-size: 13px; font-weight: normal; color: #64748b;">| Survey Verification Alert</span></h2>
        </div>

        <div style="background-color: #f8fafc; border-left: 4px solid ${color}; padding: 16px; margin: 18px 0; border-radius: 4px;">
          <span style="display: inline-block; background: ${color}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px;">${badgeText}</span>
          <h3 style="margin: 10px 0 4px 0; color: #0f172a;">${categoryName}</h3>
          <p style="margin: 0; font-size: 14px; color: #475569;">Survey Number: <strong>${property.survey_number}</strong> ${property.property_name ? '· ' + property.property_name : ''} ${property.village ? '· ' + property.village : ''}</p>
        </div>

        ${isRejected && reason ? `
          <div style="margin: 16px 0; padding: 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;">
            <strong style="color: #991b1b; display: block; margin-bottom: 6px;">Replacement Reason:</strong>
            <p style="margin: 0; color: #b91c1c; font-size: 14px;">${reason}</p>
          </div>
        ` : ''}

        ${remarks ? `
          <div style="margin: 16px 0; padding: 14px; background: #f1f5f9; border-radius: 6px;">
            <strong style="color: #334155; display: block; margin-bottom: 6px;">Reviewer Remarks:</strong>
            <p style="margin: 0; color: #475569; font-size: 14px;">${remarks}</p>
          </div>
        ` : ''}

        <p style="font-size: 13px; color: #64748b; margin-top: 20px;">Reviewer: <strong>${reviewerName || 'DNAssets Reviewer'}</strong></p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 12px; color: #94a3b8; margin: 0;">Automated email from DNAssets Survey Application.</p>
      </div>
    `;

    return sendMail({
      to: smtp.user,
      subject,
      html,
      text: `${subject}\n\nCategory: ${categoryName}\nSurvey: ${property.survey_number}\nStatus: ${status}\n${reason ? 'Reason: ' + reason + '\n' : ''}${remarks ? 'Remarks: ' + remarks + '\n' : ''}Reviewer: ${reviewerName}`
    });
  }

  async function sendReportEmail({ to, property, format, fileBuffer }) {
    const filename = `dnassets-survey-${property?.survey_number?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'report'}.${format}`;
    const contentType = format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8';

    return sendMail({
      to: to || smtp.user,
      subject: `[DNAssets] Survey Report: ${property?.survey_number ? 'Survey ' + property.survey_number : 'All Accessible Properties'}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="margin: 0 0 10px 0; color: #0f172a;">DNAssets Survey Report Export</h2>
          <p style="color: #475569; font-size: 14px;">Attached is the requested checklist and verification report for <strong>${property ? 'Survey ' + property.survey_number : 'all properties'}</strong>.</p>
          <div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 13px; color: #334155;">
            Format: <strong>${format.toUpperCase()}</strong><br>
            Survey: <strong>${property?.survey_number || 'All Properties'}</strong>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="font-size: 12px; color: #94a3b8; margin: 0;">Sent via DNAssets Workspace Gmail SMTP.</p>
        </div>
      `,
      text: `Attached is your DNAssets property report for ${property ? 'Survey ' + property.survey_number : 'all properties'} in ${format.toUpperCase()} format.`,
      attachments: [
        {
          filename,
          content: fileBuffer,
          contentType
        }
      ]
    });
  }

  async function sendUploadNotification({
    uploaderName,
    uploaderEmail,
    userId,
    fileName,
    fileType,
    fileSize,
    uploadDate = new Date(),
    surveyNumbers = 'Not Assigned',
    documentLink = '',
    processingStatus = 'Uploaded'
  }) {
    const adminRecipient = smtp.adminEmail || smtp.user;
    if (!adminRecipient) return { skipped: true, error: 'No admin recipient configured' };

    const d = uploadDate instanceof Date ? uploadDate : new Date(uploadDate);
    const dateFormatted = isNaN(d.getTime()) ? String(uploadDate) : d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
    const dateForSubject = isNaN(d.getTime()) ? String(uploadDate).split('T')[0] : d.toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });

    const formatSize = (bytes) => {
      if (!bytes || isNaN(bytes)) return '0 B';
      const k = 1024;
      const dm = 2;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };
    const sizeStr = typeof fileSize === 'number' ? formatSize(fileSize) : String(fileSize || '0 B');

    const subject = `New Survey Document Uploaded — ${uploaderName || 'Authorized User'} — ${dateForSubject}`;

    const text = [
      'A new survey document has been uploaded to the Survey Checklist website.',
      '',
      `Uploader Name: ${uploaderName || 'Not Available'}`,
      `Uploader Email: ${uploaderEmail || 'Not Available'}`,
      userId ? `User ID: ${userId}` : '',
      `File Name: ${fileName}`,
      `File Type: ${fileType || 'Not Specified'}`,
      `File Size: ${sizeStr}`,
      `Survey Numbers: ${surveyNumbers}`,
      `Upload Date: ${dateFormatted}`,
      `Processing Status: ${processingStatus}`,
      documentLink ? `Link: ${documentLink}` : '',
      '',
      'Please log in to the Survey Checklist website to review the uploaded document.'
    ].filter(Boolean).join('\n');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; color: #1e293b;">
        <div style="margin-bottom: 20px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
          <h2 style="margin: 0; color: #0f172a; font-size: 20px; font-weight: 700;">DNAssets <span style="font-size: 13px; font-weight: normal; color: #64748b;">| Survey Document Notification</span></h2>
        </div>

        <p style="font-size: 15px; color: #334155; margin: 0 0 16px 0;">A new survey document has been uploaded to the Survey Checklist website.</p>

        <div style="background-color: #f8fafc; border-left: 4px solid #16a34a; padding: 16px; margin: 16px 0; border-radius: 4px;">
          <span style="display: inline-block; background: #16a34a; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase;">
            ${processingStatus}
          </span>
          <h3 style="margin: 10px 0 4px 0; color: #0f172a; font-size: 16px; word-break: break-all;">${fileName}</h3>
          <p style="margin: 0; font-size: 14px; color: #475569;">Survey Numbers: <strong>${surveyNumbers}</strong></p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 14px;">
          <tbody>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b; width: 140px;">Uploader Name:</td>
              <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${uploaderName || 'Not Available'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">Uploader Email:</td>
              <td style="padding: 8px 0; color: #0f172a;">${uploaderEmail || 'Not Available'}</td>
            </tr>
            ${userId ? `
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">User ID:</td>
              <td style="padding: 8px 0; color: #475569; font-family: monospace; font-size: 12px;">${userId}</td>
            </tr>` : ''}
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">File Type & Size:</td>
              <td style="padding: 8px 0; color: #0f172a;">${fileType || 'Document'} · ${sizeStr}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 0; color: #64748b;">Upload Date:</td>
              <td style="padding: 8px 0; color: #0f172a;">${dateFormatted}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Processing Status:</td>
              <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${processingStatus}</td>
            </tr>
          </tbody>
        </table>

        ${documentLink ? `
          <div style="margin: 24px 0 16px 0;">
            <a href="${documentLink}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600;">View Uploaded Document →</a>
          </div>
        ` : ''}

        <p style="font-size: 13px; color: #64748b; margin-top: 20px;">Please log in to the Survey Checklist website to review the uploaded document.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 12px; color: #94a3b8; margin: 0;">Automated notification from DNAssets Survey Application.</p>
      </div>
    `;

    return sendMail({
      to: adminRecipient,
      subject,
      text,
      html
    });
  }

  return {
    enabled: true,
    sendMail,
    sendReviewAlert,
    sendReportEmail,
    sendUploadNotification,
    verify: () => transporter.verify()
  };
}
