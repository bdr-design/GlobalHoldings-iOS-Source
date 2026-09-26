# Global Holdings — Build 340 experimental candidate

Version 3.0.0 · Build 340 · Save Schema 2.0.0.

This branch keeps the full source directly tracked in Git. Its latest baseline direct-source CI run tested commit bd6bbc25fe18529fe26c2723eeafe39f5e5b9463; the present local source changes require a new commit and CI run.

Build 340 includes immutable-DTO simulation and route planning, map and finance read models, indexed procurement and fleet batches, a revision-keyed route-center index, and transaction-local finance indexes for bulk asset sale. Finance payable settlement joins 20,000 invoices to 20,000 payables in one indexed pass. The financial and fleet owners still validate and write each legal record inside the central transaction. Full Snapshot rollback remains enabled and the live field journal remains disabled.

The local Node suites pass for synthetic 4,300/20,000 row cases and transaction parity. A finance integration test exercises 256 real Finance-core collections against 20,000 pre-existing invoices, receivables and transfers; a separate fleet test uses a Finance stub and must not be read as a full 20,000-sale test. These results do not demonstrate iPhone responsiveness. Physical-device tests, frame and touch measurements, memory and thermal measurements, save/restore, and long-session behavior remain open. No IPA was built, and production approval remains closed.
