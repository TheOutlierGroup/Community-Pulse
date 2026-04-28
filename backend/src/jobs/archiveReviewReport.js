import { runArchiveReviewReport } from '../services/archiveReview.js';

async function main() {
  const result = await runArchiveReviewReport();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
