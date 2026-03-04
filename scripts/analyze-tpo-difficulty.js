/**
 * TPO 60题手工标注：类型 × 难度分布分析
 * node scripts/analyze-tpo-difficulty.js
 */

// 手工逐题分类（依据：chunk数量、语法复杂度、是否含被动/完成时/superlative/whom等）
const tpo = [
  // ── Set 1 ──
  { t:"negation",        d:"medium", a:"Unfortunately, I did not meet the deadline."              },
  { t:"interrogative",   d:"hard",   a:"Did he tell you what his favorite part was to be?"        },
  { t:"negation",        d:"easy",   a:"The content was not interesting to me."                   },
  { t:"3rd-reporting",   d:"medium", a:"She wanted to know what I do in my current position."     },
  { t:"relative",        d:"hard",   a:"I retraced all the steps that I took last night."         },
  { t:"3rd-reporting",   d:"medium", a:"She wanted to know if I went anywhere interesting."       },
  { t:"negation",        d:"medium", a:"I did not stay long enough to have fun."                  },
  { t:"negation",        d:"easy",   a:"I do not go to the gym on weekends."                      },
  { t:"direct",          d:"hard",   a:"I found the work environment at this company to be much more relaxed." },
  { t:"direct",          d:"medium", a:"I found it in the back of the furniture section."         },

  // ── Set 2 ──
  { t:"3rd-reporting",   d:"hard",   a:"Some colleagues wanted to find out where they could register for a conference." },
  { t:"negation",        d:"hard",   a:"I had not had time to read it yet."                       }, // past perfect
  { t:"negation",        d:"medium", a:"Unfortunately, the tickets were no longer available online." },
  { t:"relative",        d:"medium", a:"The diner that opened last week serves many delicious entrees." },
  { t:"relative",        d:"hard",   a:"The desk you ordered is scheduled to arrive on Friday."   }, // contact+passive
  { t:"relative",        d:"medium", a:"The bookstore I stopped by had the novel in stock."       },
  { t:"relative",        d:"hard",   a:"This coffee tastes better than all of the other brands I've tried." },
  { t:"direct",          d:"medium", a:"The store next to the post office sells all types of winter apparel." },
  { t:"direct",          d:"hard",   a:"The library is only temporarily closed in town for renovations." },
  { t:"1st-embedded",    d:"medium", a:"I can suggest one that my sister might be interested in." },

  // ── Set 3 ──
  { t:"3rd-reporting",   d:"medium", a:"He wanted to know what I liked best about it."           },
  { t:"3rd-reporting",   d:"medium", a:"Yes, she wanted to know why we have not tried the new cafe." },
  { t:"3rd-reporting",   d:"medium", a:"They asked me what our specific requirements are."        },
  { t:"3rd-reporting",   d:"hard",   a:"The managers wanted to know how we were able to make the sale." },
  { t:"1st-embedded",    d:"hard",   a:"We just found out where the materials are being stored."  }, // passive
  { t:"3rd-reporting",   d:"hard",   a:"She wanted to know whom I will give feedback to."         }, // whom
  { t:"1st-embedded",    d:"medium", a:"I can't decide which is the most important topic."        },
  { t:"3rd-reporting",   d:"medium", a:"He asked me what I thought about his presentation."       },
  { t:"3rd-reporting",   d:"medium", a:"They wanted to know when you were going to Spain."        },
  { t:"3rd-reporting",   d:"medium", a:"She was curious about where I learned to speak Korean."   },

  // ── Set 4 ──
  { t:"1st-embedded",    d:"medium", a:"I did not understand what he said."                       },
  { t:"1st-embedded",    d:"hard",   a:"I have not heard who is going to be in charge."           }, // who as subject
  { t:"3rd-reporting",   d:"medium", a:"They want to know when we expect the project to finish."  },
  { t:"1st-embedded",    d:"easy",   a:"I have no idea where they are going."                     },
  { t:"negation",        d:"medium", a:"I did not think it would start on time."                  },
  { t:"3rd-reporting",   d:"medium", a:"Yes, she wanted to know if we needed more time to finish."},
  { t:"3rd-reporting",   d:"medium", a:"She was curious about who needs to attend it."            },
  { t:"3rd-reporting",   d:"medium", a:"The manager wants to know how we can resolve them quickly."},
  { t:"interrogative",   d:"medium", a:"Could you tell me how you are feeling about it."          },
  { t:"interrogative",   d:"medium", a:"Can you tell me what you did not like about it?"          },

  // ── Set 5 ──
  { t:"3rd-reporting",   d:"easy",   a:"He wants to know if you need a ride to Saturday's game."  },
  { t:"3rd-reporting",   d:"medium", a:"She wanted to know if I plan to make any revisions."      },
  { t:"interrogative",   d:"easy",   a:"Can you tell me what your plans are for tomorrow?"        },
  { t:"3rd-reporting",   d:"medium", a:"They wanted to know why you decided to adopt a pet."      },
  { t:"1st-embedded",    d:"medium", a:"I don't understand why he doesn't take lessons."          },
  { t:"1st-embedded",    d:"hard",   a:"I would love to know which dish you enjoyed most."        }, // superlative
  { t:"1st-embedded",    d:"hard",   a:"I would love to know where you learned such interesting facts." },
  { t:"3rd-reporting",   d:"medium", a:"He wanted to know why I am always late to our sessions."  },
  { t:"interrogative",   d:"easy",   a:"Can you tell me if the professor covered any new material?"},
  { t:"3rd-reporting",   d:"easy",   a:"He wanted to know if I had another meeting."              },

  // ── Set 6 ──
  { t:"negation",        d:"easy",   a:"I have not gotten tickets for the event yet."             },
  { t:"negation",        d:"easy",   a:"I could not make it due to a prior engagement."           },
  { t:"3rd-reporting",   d:"medium", a:"He needed to know why I requested to work remotely."      },
  { t:"negation",        d:"easy",   a:"I am not able to attend due to a prior commitment."       },
  { t:"negation",        d:"easy",   a:"I am not accustomed to spicy food like that."             },
  { t:"3rd-reporting",   d:"medium", a:"She was wondering if I found the exhibit inspiring."      },
  { t:"3rd-reporting",   d:"medium", a:"She wanted to know where it was held."                    },
  { t:"3rd-reporting",   d:"hard",   a:"He wanted to know where all the accountants had gone."    }, // past perfect
  { t:"interrogative",   d:"hard",   a:"Did he ask you why you chose this particular career?"     },
  { t:"3rd-reporting",   d:"medium", a:"He wants to know what our biggest concerns are."          },
];

const types = ["negation","3rd-reporting","1st-embedded","interrogative","direct","relative"];
const diffs = ["easy","medium","hard"];

// Build cross-tab
const grid = {};
types.forEach(t => { grid[t] = {easy:0,medium:0,hard:0,total:0}; });
tpo.forEach(q => { grid[q.t][q.d]++; grid[q.t].total++; });

console.log("\n=== TPO Type × Difficulty (60 questions) ===\n");
console.log("Type".padEnd(22) + "Total".padEnd(8) + "Easy".padEnd(10) + "Medium".padEnd(12) + "Hard".padEnd(10) + "Tendency");
console.log("─".repeat(80));

const tendency = {
  "negation":      "Easy → Medium",
  "3rd-reporting": "Medium (dominant)",
  "1st-embedded":  "Medium → Hard",
  "interrogative": "Easy → Medium",
  "direct":        "Medium → Hard",
  "relative":      "Hard (dominant)",
};

types.forEach(t => {
  const r = grid[t];
  const ep = Math.round(r.easy/r.total*100);
  const mp = Math.round(r.medium/r.total*100);
  const hp = Math.round(r.hard/r.total*100);
  console.log(
    t.padEnd(22) +
    String(r.total).padEnd(8) +
    `${r.easy}(${ep}%)`.padEnd(10) +
    `${r.medium}(${mp}%)`.padEnd(12) +
    `${r.hard}(${hp}%)`.padEnd(10) +
    tendency[t]
  );
});

console.log("\n=== Per-difficulty type mix ===\n");
diffs.forEach(d => {
  const items = tpo.filter(q => q.d === d);
  const counts = {};
  types.forEach(t => counts[t] = 0);
  items.forEach(q => counts[q.t]++);
  console.log(`${d.toUpperCase()} (${items.length} total):`);
  types.forEach(t => {
    if (counts[t] > 0) {
      const pct = Math.round(counts[t]/items.length*100);
      console.log(`  ${t.padEnd(20)} ${counts[t]}  (${pct}%)`);
    }
  });
  console.log();
});

console.log("=== Implication for generation quota (10 sets, 100 questions) ===\n");
console.log("Target distribution per type:");
const targets = {
  "negation":      {n:18, easy:9, medium:7, hard:2},
  "3rd-reporting": {n:42, easy:4, medium:28, hard:10},
  "1st-embedded":  {n:12, easy:1, medium:6, hard:5},
  "interrogative": {n:10, easy:4, medium:4, hard:2},
  "direct":        {n:10, easy:0, medium:6, hard:4},
  "relative":      {n:8,  easy:0, medium:2, hard:6},
};
types.forEach(t => {
  const q = targets[t];
  console.log(`  ${t.padEnd(20)} total=${q.n}  easy=${q.easy}  medium=${q.medium}  hard=${q.hard}`);
});
