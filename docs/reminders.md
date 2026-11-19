# Standalone reminders

Step 1 stores standalone reminders in public.user_reminders. The service entry points are createReminder({ id, title, dueAt }), listReminders({ startAt, endAt, after, limit }), and completeReminder(id) in src/services/reminderService.js.

## Due time contract

due_at is a timestamptz: an absolute instant. The service accepts a JavaScript Date or a timezone-aware ISO timestamp and sends its UTC ISO representation. It rejects date-time strings without an offset. A future capture form using the device's local timezone should construct a local Date from the chosen calendar date and time, then pass date.toISOString(). If the user can choose a display timezone, the UI must convert the selected local date/time using that named timezone before calling the service.

Today queries take explicit instants and use the half-open interval [startAt, endAt). In the chosen display timezone, derive local midnight and the next calendar day's midnight separately, then convert both to ISO instants. Do not calculate the end by adding 24 hours: a local day across a daylight-saving transition can be 23 or 25 hours. The service does not choose a timezone or calculate calendar boundaries.

## Retry and paging contract

The caller generates one UUID with createReminderId() for a capture attempt and retains that same ID until the outcome is confirmed. createReminder is idempotent for an ID and identical title/due instant; reusing an ID with different details is rejected. Errors expose outcome as offline, unknown, or rejected, and a retryable flag. unknown means the request may have reached the server; check by ID or retry the same create with the same ID. The service does not queue writes or automatically retry.

listReminders requires a bounded start/end range and returns at most the requested page size (maximum 100). When another page exists, nextCursor contains both dueAt and id; pass it back as after to continue after that exact ordering key. The database orders by due time and ID. The migration adds only the primary-key index; further indexes need query-plan and write-cost evidence.