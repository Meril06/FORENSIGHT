-- FORENSIGHT - Step 2: seed the demo case (CASE-001, synthetic)
-- WARNING: this file contains the ground-truth ANSWERS (see the "TRUTH" section).
-- It is developer-only. Trainees never see the truth schema.
-- Safe to re-run: it deletes and recreates CASE-001 each time.

BEGIN;

DELETE FROM cases WHERE case_code = 'CASE-001';

-- ---------- 1. THE CASE (trainee-visible) ----------
INSERT INTO cases (id, case_code, title, description, difficulty, category, platform,
                   source_type, source_name, source_reference, license)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'CASE-001',
  'Unauthorized Confidential-File Transfer',
  'A finance employee is suspected of copying a confidential acquisition plan to an external USB drive on workstation WS-FIN-07 on 12 March 2026. You have been given artifacts extracted from the workstation. Determine what happened, and decide how much of the evidence you can trust.',
  'MEDIUM',
  'USB activity',
  'Windows 10',
  'SYNTHETIC',
  'FORENSIGHT original synthetic case',
  NULL,
  'Original synthetic data created for this project'
);

-- ---------- 2. THE ARTIFACTS (trainee-visible, Evidence DNA) ----------
INSERT INTO artifacts
  (id, case_id, artifact_code, name, type, source, path, description, content, mime_type,
   created_at_ts, modified_at_ts, accessed_at_ts, acquired_at_ts, provenance)
VALUES
('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','EV-001',
 'Security log - interactive logon','WINDOWS_EVENT_LOG','Security.evtx',
 'C:/Windows/System32/winevt/Logs/Security.evtx',
 'Successful interactive logon recorded for user rmehta.',
 '{"event_id":4624,"description":"An account was successfully logged on","logon_type":2,"account":"rmehta","workstation":"WS-FIN-07","time":"2026-03-12T09:14:02Z"}'::jsonb,
 'application/json','2026-03-12 09:14:02+00','2026-03-12 09:14:02+00',NULL,'2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','EV-002',
 'USB device connection record','REGISTRY','SYSTEM hive (USBSTOR) + setupapi.dev.log',
 'C:/Windows/System32/config/SYSTEM',
 'Registry and setup log entries for a removable USB storage device.',
 '{"device":"Kingston DataTraveler 3.0","serial":"60A44C413C30F1A1","vendor_id":"0951","product_id":"1666","first_connected":"2026-03-12T09:18:11Z","last_removed":"2026-03-12T09:25:30Z","drive_letter":"E:","prior_connections":0}'::jsonb,
 'application/json','2026-03-12 09:18:11+00','2026-03-12 09:25:30+00',NULL,'2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','EV-003',
 'Recent items - document opened','JUMP_LIST','Excel Jump List',
 'C:/Users/rmehta/AppData/Roaming/Microsoft/Windows/Recent/AutomaticDestinations',
 'Jump List entry showing a spreadsheet opened in Excel.',
 '{"application":"Excel","file":"Q3_Acquisition_Plan.xlsx","path":"C:/Finance/Confidential/Q3_Acquisition_Plan.xlsx","opened":"2026-03-12T09:21:07Z","open_count":1}'::jsonb,
 'application/json','2026-03-12 09:21:07+00','2026-03-12 09:21:07+00',NULL,'2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001','EV-004',
 'Shortcut (LNK) - file on removable drive','LNK_FILE','Windows shortcut + volume record',
 'C:/Users/rmehta/AppData/Roaming/Microsoft/Windows/Recent',
 'Shortcut artifact showing a file present on the removable drive E:.',
 '{"source":"C:/Finance/Confidential/Q3_Acquisition_Plan.xlsx","destination":"E:/Q3_Acquisition_Plan.xlsx","operation":"file_created_on_removable_volume","time":"2026-03-12T09:23:44Z","bytes":2483712}'::jsonb,
 'application/json','2026-03-12 09:23:44+00','2026-03-12 09:23:44+00',NULL,'2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000001','EV-005',
 'Process creation - robocopy','PROCESS_EXECUTION','Sysmon Event ID 1',
 'C:/Windows/System32/winevt/Logs/Microsoft-Windows-Sysmon%4Operational.evtx',
 'Process-creation event for the robocopy utility.',
 '{"executable":"ROBOCOPY.EXE","run_count":1,"started":"2026-03-12T09:23:41Z","command_line":"robocopy C:/Finance/Confidential E: Q3_Acquisition_Plan.xlsx","parent_process":"cmd.exe","user":"rmehta"}'::jsonb,
 'application/json','2026-03-12 09:23:41+00','2026-03-12 09:23:41+00',NULL,'2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000006','c0000000-0000-0000-0000-000000000001','EV-006',
 'Firewall log - outbound connection','NETWORK_LOG','Host firewall log',
 'C:/Windows/System32/LogFiles/Firewall/pfirewall.log',
 'Outbound HTTPS connection recorded shortly after the USB activity.',
 '{"protocol":"HTTPS","destination":"download.windowsupdate.com","destination_ip":"203.0.113.25","bytes_out":18422,"bytes_in":9211344,"time":"2026-03-12T09:27:15Z","process":"svchost.exe"}'::jsonb,
 'application/json','2026-03-12 09:27:15+00','2026-03-12 09:27:15+00',NULL,'2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000007','c0000000-0000-0000-0000-000000000001','EV-007',
 'File metadata - Q3_Acquisition_Plan.xlsx','FILE_METADATA','NTFS Master File Table',
 'C:/Finance/Confidential/Q3_Acquisition_Plan.xlsx',
 'File-system metadata for the confidential spreadsheet.',
 '{"file":"C:/Finance/Confidential/Q3_Acquisition_Plan.xlsx","size_bytes":2483712,"created":"2026-02-27T15:40:00Z","modified":"2026-03-10T17:05:12Z","accessed":"2026-03-12T09:21:08Z","owner":"rmehta"}'::jsonb,
 'application/json','2026-02-27 15:40:00+00','2026-03-10 17:05:12+00','2026-03-12 09:21:08+00','2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000008','c0000000-0000-0000-0000-000000000001','EV-008',
 'Browser history (Chrome)','BROWSER_HISTORY','Chrome History database',
 'C:/Users/rmehta/AppData/Local/Google/Chrome/User Data/Default/History',
 'Chrome browsing history for the user profile.',
 '{"browser":"Chrome","entries":[{"url":"https://intranet.corp.example/home","visited":"2026-03-12T09:15:30Z"},{"url":"https://intranet.corp.example/finance","visited":"2026-03-12T09:16:02Z"}],"acquisition_note":"No entries after 09:16:02 and the journal file is missing."}'::jsonb,
 'application/json','2026-03-12 09:15:30+00','2026-03-12 09:16:02+00',NULL,'2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000009','c0000000-0000-0000-0000-000000000001','EV-009',
 'Security log - object access and task creation','WINDOWS_EVENT_LOG','Security.evtx',
 'C:/Windows/System32/winevt/Logs/Security.evtx',
 'Security audit events for file access and scheduled-task creation.',
 '{"events":[{"event_id":4663,"description":"An attempt was made to access an object","object":"C:/Finance/Confidential/Q3_Acquisition_Plan.xlsx","account":"rmehta","time":"2026-03-12T09:21:07Z"},{"event_id":4698,"description":"A scheduled task was created","task_name":"CleanupTask","account":"rmehta","time":"2026-03-12T09:26:40Z"}]}'::jsonb,
 'application/json','2026-03-12 09:21:07+00','2026-03-12 09:26:40+00',NULL,'2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.'),

('a0000000-0000-0000-0000-000000000010','c0000000-0000-0000-0000-000000000001','EV-010',
 'cleanup_task.xml','SCHEDULED_TASK','Task Scheduler definition file',
 'C:/Windows/System32/Tasks/CleanupTask',
 'Scheduled-task definition for an automatic cleanup job.',
 '{"task_name":"CleanupTask","author":"rmehta","registered":"2026-03-11T22:00:00Z","last_run":"2026-03-12T08:50:00Z","action":"Delete files in C:/Users/rmehta/AppData/Local/Temp older than 1 day"}'::jsonb,
 'application/xml','2026-03-12 09:26:41+00','2026-03-11 22:00:00+00','2026-03-12 09:26:45+00','2026-03-13 10:00:00+00',
 'Synthetic image of WS-FIN-07, acquired 2026-03-13 by examiner A. Rao using a write-blocker.');

-- Real hashes, calculated from the stored content (not typed in by hand)
UPDATE artifacts
SET sha256 = encode(sha256(convert_to(content::text, 'UTF8')), 'hex'),
    size   = octet_length(content::text)
WHERE case_id = 'c0000000-0000-0000-0000-000000000001';

-- ---------- 3. TIMELINE EVENT POOL (trainee-visible candidates) ----------
-- The trainee decides which of these are trustworthy and puts them in order.
INSERT INTO timeline_events (id, case_id, artifact_id, event_code, ts, event_type, description) VALUES
('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','TL-001','2026-03-12 09:14:02+00','AUTHENTICATION','User rmehta logged on interactively'),
('e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','TL-002','2026-03-12 09:18:11+00','USB_CONNECTED','Kingston DataTraveler connected as drive E:'),
('e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003','TL-003','2026-03-12 09:21:07+00','FILE_ACCESS','Q3_Acquisition_Plan.xlsx opened in Excel'),
('e0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','TL-004','2026-03-12 09:23:44+00','FILE_COPY','Q3_Acquisition_Plan.xlsx created on drive E:'),
('e0000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','TL-005','2026-03-12 09:25:30+00','USB_REMOVED','USB device last removed'),
('e0000000-0000-0000-0000-000000000006','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000006','TL-006','2026-03-12 09:27:15+00','NETWORK','HTTPS connection to download.windowsupdate.com'),
('e0000000-0000-0000-0000-000000000007','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000008','TL-007','2026-03-12 09:16:02+00','BROWSER','Intranet finance page visited'),
('e0000000-0000-0000-0000-000000000008','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000010','TL-008','2026-03-12 08:50:00+00','TASK_RUN','CleanupTask last run (according to task definition)'),
('e0000000-0000-0000-0000-000000000009','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005','TL-009','2026-03-12 09:23:41+00','PROCESS','robocopy.exe started by rmehta');

-- ---------- 4. TRUTH (hidden - never sent to trainees) ----------
INSERT INTO truth.artifact_truth (artifact_id, true_status, relevance, manipulation_risk, manipulation_type, reason)
SELECT a.id, v.status::evidence_status, v.rel, v.risk, v.mtype, v.reason
FROM (VALUES
 ('EV-001','GENUINE',    0.70,0.05,NULL,'Logon matches the user and workstation; corroborated by the later activity.'),
 ('EV-002','GENUINE',    1.00,0.05,NULL,'Device appears for the first time and is removed after the copy window.'),
 ('EV-003','GENUINE',    0.90,0.05,NULL,'Corroborated by the Security log (EV-009) and file metadata (EV-007).'),
 ('EV-004','GENUINE',    1.00,0.05,NULL,'File size matches EV-007 and the time falls inside the USB window.'),
 ('EV-005','GENUINE',    0.80,0.05,NULL,'robocopy started 3 seconds before the file appeared on E:.'),
 ('EV-006','IRRELEVANT', 0.10,0.00,NULL,'Routine Windows Update traffic; tiny upload, not exfiltration.'),
 ('EV-007','GENUINE',    0.80,0.05,NULL,'Access time matches EV-003 and EV-009; size matches EV-004.'),
 ('EV-008','INCOMPLETE', 0.30,0.20,NULL,'History is truncated, so it can neither confirm nor deny anything after 09:16.'),
 ('EV-009','GENUINE',    0.90,0.05,NULL,'Independent audit source. Its event 4698 shows CleanupTask was created at 09:26:40.'),
 ('EV-010','POISONED',   0.60,0.95,'TIMESTAMP_TAMPERING','Claims registration on 03-11 22:00, but the file was created at 09:26:41 on 03-12, its modified time is earlier than its creation time, and EV-009 shows the task was created at 09:26:40 - after the transfer.')
) AS v(code, status, rel, risk, mtype, reason)
JOIN artifacts a ON a.artifact_code = v.code AND a.case_id = 'c0000000-0000-0000-0000-000000000001';

INSERT INTO truth.case_hypotheses (case_id, code, title, description, is_true) VALUES
('c0000000-0000-0000-0000-000000000001','H1','Employee copied the files','The logged-in employee copied the confidential file to a personal USB drive.',true),
('c0000000-0000-0000-0000-000000000001','H2','External attacker copied the files','A remote attacker used the account to copy the file.',false),
('c0000000-0000-0000-0000-000000000001','H3','Automated job caused the activity','A scheduled cleanup or backup job caused the file activity.',false),
('c0000000-0000-0000-0000-000000000001','H4','Evidence was planted','The USB activity was fabricated by someone else.',false);

INSERT INTO truth.case_truth (case_id, primary_hypothesis, incident_occurred, required_evidence, expected_timeline)
VALUES (
  'c0000000-0000-0000-0000-000000000001', 'H1', true,
  ARRAY(SELECT id FROM artifacts
        WHERE case_id = 'c0000000-0000-0000-0000-000000000001'
          AND artifact_code IN ('EV-002','EV-003','EV-004','EV-007','EV-009')),
  ARRAY(SELECT id FROM timeline_events
        WHERE case_id = 'c0000000-0000-0000-0000-000000000001'
          AND event_code IN ('TL-001','TL-002','TL-003','TL-004','TL-005')
        ORDER BY ts)
);

INSERT INTO truth.true_relationships (case_id, source_artifact_id, target_artifact_id, relationship_type, explanation)
SELECT 'c0000000-0000-0000-0000-000000000001', s.id, t.id, v.rtype::relationship_type, v.expl
FROM (VALUES
 ('EV-003','EV-009','CORROBORATES','Two independent sources record the same file access at 09:21:07.'),
 ('EV-003','EV-007','CORROBORATES','File access time matches the metadata access time.'),
 ('EV-004','EV-007','CORROBORATES','Copied file size equals the original file size.'),
 ('EV-005','EV-004','SUPPORTS','robocopy started just before the file appeared on E:.'),
 ('EV-002','EV-004','SUPPORTS','The USB device was connected when the copy happened.'),
 ('EV-009','EV-010','CONTRADICTS','Security log shows the task was created after the transfer, not on 03-11.')
) AS v(scode, tcode, rtype, expl)
JOIN artifacts s ON s.artifact_code = v.scode AND s.case_id = 'c0000000-0000-0000-0000-000000000001'
JOIN artifacts t ON t.artifact_code = v.tcode AND t.case_id = 'c0000000-0000-0000-0000-000000000001';

COMMIT;