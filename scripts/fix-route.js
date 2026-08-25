const fs = require('fs');
const path = 'src/app/api/chat/route.ts';
let s = fs.readFileSync(path, 'utf8');

// Find the line with "const counselingAvailable =" and insert the new variables before it
const target = '  const counselingAvailable =\n    isUnanswered ||\n    topic === "fee structure" ||\n    looksLikePhoneNumber(latestQuery) ||\n    isAgreement(latestQuery) ||\n    recentAssistantOfferedCounseling(history) ||\n    isShortResponseToAssistant);';

const replacement = `  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  const isShortResponseToAssistant =
    latestQuery.trim().length <= 10 &&
    lastAssistant &&
    /counsel|contact you|phone number|reach you|team.*contact|would you like/i.test(lastAssistant.content);

  const counselingAvailable =
    isUnanswered ||
    topic === "fee structure" ||
    looksLikePhoneNumber(latestQuery) ||
    isAgreement(latestQuery) ||
    recentAssistantOfferedCounseling(history) ||
    isShortResponseToAssistant);`;

if (!s.includes(replacement)) {
  console.log('Replacement not found, applying...');
  // Find and replace the broken line
  s = s.replace('    isShortResponseToAssistant);', '    isShortResponseToAssistant);');
  // Insert the new variables before counselingAvailable
  s = s.replace(
    '  const counselingAvailable =',
    `  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  const isShortResponseToAssistant =
    latestQuery.trim().length <= 10 &&
    lastAssistant &&
    /counsel|contact you|phone number|reach you|team.*contact|would you like/i.test(lastAssistant.content);

  const counselingAvailable =`
  );
  fs.writeFileSync(path, s);
  console.log('Fixed!');
} else {
  console.log('Already fixed');
}
