// The worked examples bundled in templates/. Each is a conforming ICR v0.2.
// ICR-AB-0001 comes from the Appointment Booking sample; the other three are the specification's
// worked examples. All organisations, names and contacts in them are fictional.

export const EXAMPLES = [
  { file: 'ICR-AB-0001-booking-api.md', id: 'ICR-AB-0001', label: 'Appointment Booking: Booking API', note: 'Synchronous API through a gateway (Integration API Management, External)', featured: true },
  { file: 'ICR-AB-0002-calendar-sync.md', id: 'ICR-AB-0002', label: 'Appointment Booking: Calendar synchronisation', note: 'Events from calendar providers (Integration Native Connectors, Cloud)' },
  { file: 'ICR-AB-0003-notifications.md', id: 'ICR-AB-0003', label: 'Appointment Booking: Notification delivery', note: 'Messages through a queue to a delivery provider (Integration Middleware Services, Cloud)' },
  { file: '0001-partner-booking-api.md', id: 'ICR-0001', label: 'Partner room availability and booking API', note: 'Specification example: synchronous, external' },
  { file: '0002-meter-reading-stream.md', id: 'ICR-0002', label: 'Interval meter reading event stream', note: 'Specification example: events between organisations' },
  { file: '0003-contractor-production-files.md', id: 'ICR-0003', label: 'Contractor nightly production files', note: 'Specification example: batch file exchange' },
];

export const FEATURED = EXAMPLES.find((e) => e.featured);
