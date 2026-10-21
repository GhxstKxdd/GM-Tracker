# Performance Tracker

A local-first Windows desktop prototype for monthly reviews of a B2B outbound SDR team.

## Monthly agent reviews

- Each agent has an individual monthly scorecard with outbound KPIs, campaign lead targets versus actuals, attendance, manager and agent feedback, and a drawn signature acknowledging the review.
- Revenue and follow-up tracking are excluded from the outbound review.
- Campaign results are summed by agent and campaign for the selected month. Attendance counts are shown per agent; attendance rate is present days divided by scheduled days (present, absent, and sick).
- Monthly KPI totals such as Calls Made, Deals Closed, and Conversion Rate can be imported separately or edited in the app. Campaign results and attendance are enough to prepare a campaign and attendance review; the monthly KPI totals are optional.
- Any KPI, campaign, or attendance change after sign-off clears that month’s acknowledgment and is recorded in the audit history.
- The dashboard provides team context. Reports can be selected, printed, and exported one agent at a time.

## Application logins

The first launch asks the GM to create the first user account; there is no shared default password. The GM can create, reset, and disable Team Leader logins from **User access**. Team Leaders can review and enter KPI, campaign, and attendance data. User administration is enforced in the Electron main process as well as the interface. Passwords are stored as per-user salted scrypt hashes, and five failed login attempts lock that account for 15 minutes. The login screen explains forgotten-credential recovery. A Team Leader asks the GM to look up their username or reset their password in **User access**. The GM can recover a forgotten GM username and password from the login screen; this resets the GM credentials on this computer without deleting tracker data. Protect the Windows account because anyone with access to this computer can use local GM recovery.

This version protects access inside the app on one Windows user profile. The local SQLite database is not encrypted at rest, and accounts do not sync to other computers. Keep the Windows account protected and use the future authenticated backend for shared multi-computer access.

## Agent identity

An agent can acknowledge a monthly review by drawing a signature with a mouse or trackpad. The signature image, agent name, and timestamp are stored with the review and included in the report. Changes to KPI, campaign, or attendance data clear the signature. The drawn signature records acknowledgment; it does not independently verify who drew it or provide a certified electronic-signature service.

Shared access across computers requires a backend, managed user accounts, permissions, and synchronization.

## Import workbook

The sample workbook is included in the installer and can be saved from **Import → Save sample workbook**. It has two simple tabs:

| Tab | Required columns |
| --- | --- |
| Campaign Results | Agent Name, Date, Campaign, Target, Actual |
| Attendance | Agent Name, Date, Status |

The example campaign data uses HPE, Dell, and Lenovo. Attendance includes fictional present, absent, sick, and leave entries; all names and results are sample data.

Use one campaign row per agent, date, and campaign. Use one attendance row per agent and date. Accepted attendance values include Present, Absent, Leave, Sick, and Off. If your source files are separate, choose them together; if they are tabs in one workbook, choose the workbook once.

Monthly KPI totals are optional and can be imported on an additional sheet with `period`, `rep`, `kpi_code`, `target`, and `actual` columns. Supported codes are `CALLS_MADE`, `DEALS_CLOSED`, and `CONVERSION_RATE`. CSV and XLSX are supported; `.xls` is not. The importer previews all supported rows, checks dates, numbers, duplicate rows, and agent names, then saves the valid data together. Reimporting an existing campaign/date or attendance/date updates that row.

Unstructured source sheets without target and actual columns (for example, a raw lead list) are identified in the preview but need their columns mapped or reshaped to the sample workbook format before they can contribute to campaign totals. QA and contact-list records are not yet included in the monthly scorecard.

## Development

- Requires Node.js 24+ and npm. Git is recommended.
- `npm install` downloads the open-source app and developer dependencies.
- `npm run dev` launches the desktop app.
- `npm run typecheck` checks TypeScript.
- `npm test` runs KPI, CSV/XLSX validation, and local database tests.
- `npm run build` builds the desktop app.
- `npm run package:win` builds an NSIS Windows installer in `release/`.

The Windows installer is unsigned without a code-signing certificate, so Windows may show a publisher warning. The app stores its database in the current Windows user’s application-data folder, separate from the installation directory.
