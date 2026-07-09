# L1 嫌疑复审明细 — 2026-07-09

L1 全量二审的 182 条嫌疑，用同款 auditor 复审并保留完整明细。
**复现性**：`复现`=两轮独立作答都不同意答案键(优先人审)；`未复现`=复审干净(边缘案例, 可降级)；`error`=待重试。

| 库 | 嫌疑 | 复现 | 未复现 | 多解 | error | 未跑 |
|---|---|---|---|---|---|---|
| ap | 27 | 26 | 1 | 0 | 0 | 0 |
| rdl-long | 2 | 1 | 1 | 0 | 0 | 0 |
| ctw | 114 | 109 | 5 | 0 | 0 | 0 |
| lat | 27 | 21 | 5 | 1 | 0 | 0 |
| la | 4 | 1 | 2 | 1 | 0 | 0 |
| lcr | 8 | 6 | 0 | 2 | 0 | 0 |


## ap（嫌疑 27: 复现 26 / 未复现 1 / 多解 0 / error 0 / 未跑 0）

### ap_mpveuehi_4 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **B** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For example, the cathedral at Chartres replaced nearly its entire upper wall with windows, some rising more than thirteen meters high.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1
    - B. Slot 2
    - C. Slot 3
    - D. Slot 4
  - AI 理由: AI says B, marked C. AI reasoning: The sentence about Chartres replacing its upper wall with windows fits after the statement that walls could be pierced with glass, which is at slot 2.
### ap_mpvfq0ri_1 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **D** vs AI **C** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For instance, the catastrophic Dust Bowl of the 1930s drove thousands of families from their land.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 [■]
    - B. Slot 2 [■]
    - C. Slot 3 [■]
    - D. Slot 4 [■]
  - AI 理由: AI says C, marked D. AI reasoning: The sentence about the Dust Bowl provides a specific example of the disasters mentioned just before slot 3, where it says 'These disasters finally forced scientists and governments to treat erosion as an urgent threat.'
### ap_mpw0aj3v_0 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **B** vs AI **A** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'Imagine a steep hill that a ball must be pushed over; the enzyme effectively flattens part of that slope.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 (after "...must overcome to proceed.")
    - B. Slot 2 (after "...toward an unstable transition state.")
    - C. Slot 3 (after "...than it would unaided.")
    - D. Slot 4 (after "...thousands of times each second.")
  - AI 理由: AI says A, marked B. AI reasoning: The sentence about flattening a slope is an analogy for lowering activation energy, which is introduced in the sentence before slot 1.
### ap_mpw0icii_1 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **A** vs AI **C** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'And because every stroke is permanent once the ink touches the absorbent paper, no error can be corrected after the fact.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 (paragraph 1, after the sentence on tension)
    - B. Slot 2 (paragraph 2, after the topic sentence)
    - C. Slot 3 (paragraph 2, before the sentence on disciplined repetition)
    - D. Slot 4 (paragraph 3, after the topic sentence)
  - AI 理由: AI says C, marked A. AI reasoning: The sentence about the permanence of strokes and inability to correct errors logically fits after describing the process of copying and before discussing disciplined repetition, as it explains why careful practice is crucial. Slot 3 is in paragraph 2 after the sentence about introducing variations and before the sentence on disciplined repetition.
### ap_mpw0p1eh_1 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **B** vs AI **C** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'For example, a single excited oxygen atom may glow for nearly a second before this release occurs.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 (paragraph 2, after the thin-atmosphere sentence)
    - B. Slot 2 (paragraph 2, after the excitation sentence)
    - C. Slot 3 (paragraph 2, after the photon-release sentence)
    - D. Slot 4 (paragraph 3, after the value sentence)
  - AI 理由: AI says C, marked B. AI reasoning: The sentence about a single excited oxygen atom glowing before release fits best after the explanation that atoms release energy as photons, as it provides an example of the timing of that release.
### ap_mpw14a6x_0 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **D** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For example, a pine tree and a nearby birch joined by the same fungus can effectively share what each one gathers.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 (paragraph 1, after the opening definition)
    - B. Slot 2 (paragraph 2, after the topic sentence)
    - C. Slot 3 (paragraph 2, after the sentence about a single fungal body linking several plants)
    - D. Slot 4 (paragraph 2, after the sentence about carbon moving between neighboring trees)
  - AI 理由: AI says D, marked C. AI reasoning: The added sentence provides a specific example of sharing between a pine and a birch, which fits after the general statement about carbon moving between neighboring trees (slot 4).
### ap_r1_routine-20260531-134653_2 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **B** vs AI **A** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'Imagine, for instance, the first stage: rising carbon dioxide directly warms the lower atmosphere by a small but measurable amount.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1
    - B. Slot 2
    - C. Slot 3
    - D. Slot 4
  - AI 理由: AI says A, marked B. AI reasoning: The added sentence describes the first stage of warming, which logically follows the mention of 'a chain of feedback processes' and precedes the specific feedback examples.
### ap_r1_1 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **A** vs AI **B** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'And because this transition can unfold within a single generation, even well-prepared governments often struggle to react in time.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1
    - B. Slot 2
    - C. Slot 3
    - D. Slot 4
  - AI 理由: AI says B, marked A. AI reasoning: The sentence about the transition unfolding within a generation fits best after describing the shift from favorable ratio to burden, as it explains the challenge of reacting in time.
### ap_mpvlbkmf_1 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **B** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'For example, Porter's 1903 film *The Great Train Robbery* cut rapidly between the robbers and the posse pursuing them, modeling a technique that became standard within a decade.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 (paragraph 1, end)
    - B. Slot 2 (paragraph 2, after Porter and Griffith are introduced)
    - C. Slot 3 (paragraph 2, after the list of innovations)
    - D. Slot 4 (paragraph 3, after the sound pivot)
  - AI 理由: AI says B, marked C. AI reasoning: The sentence provides an example of Porter's innovation, so it fits best after Porter and Griffith are introduced in paragraph 2.
### ap_mpvlbkmf_2 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **B** vs AI **C** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'And because written records were treated as the only trustworthy historical evidence, entire bodies of indigenous testimony were left unstudied for decades.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 (paragraph 1, end)
    - B. Slot 2 (paragraph 2, after the opening claim)
    - C. Slot 3 (paragraph 2, after the formal devices description)
    - D. Slot 4 (paragraph 3, after the pivot)
  - AI 理由: AI says C, marked B. AI reasoning: The sentence explains a consequence of treating written records as the only trustworthy evidence. It logically follows the description of how early researchers ignored formal devices and disregarded oral testimony, fitting best at slot 3.
### ap_mpx0lfar_1 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **D** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'For example, Monet painted the Rouen Cathedral facade more than thirty times to record how its appearance shifted across hours and seasons.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 (paragraph 1, after the founding date)
    - B. Slot 2 (paragraph 2, before the palette discussion)
    - C. Slot 3 (paragraph 2, after the new pigments are listed)
    - D. Slot 4 (paragraph 3, after the introduction of tensions)
  - AI 理由: AI says D, marked C. AI reasoning: The sentence about Monet painting the cathedral multiple times illustrates the 'tensions' and limitations of capturing fleeting light mentioned in paragraph 3, so it fits best after the introduction of tensions.
### ap_mpx0lfar_2 — ✗ 复现（L1: criticalFlags=1）
- **Q3**: 答案键 **D** vs AI **B** (置信 medium)
  - 题干: What can be inferred from paragraph 2 about northern quoll populations?
    - A. They migrated to areas without cane toads in response to the invasion
    - B. They lacked previous exposure to predators with similar chemical defenses
    - C. They competed with crocodiles for the same prey species
    - D. They were the primary predators of cane toads in the Daly River area
  - AI 理由: AI says B, marked D. AI reasoning: The passage notes that northern quoll populations collapsed after eating toads, implying they had no prior adaptation to bufotoxins, which suggests a lack of previous exposure to similar chemical defenses.
### ap_mpzvh9ag_0 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **D** vs AI **C** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'And because the particles include the silica shells of microscopic plankton, the resulting deposits preserve a continuous chemical record of past ocean conditions.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. [■] in paragraph 1, after the definition sentence
    - B. [■] in paragraph 2, after the pelagic sedimentation definition
    - C. [■] in paragraph 2, after the millennium-rate sentence
    - D. [■] in paragraph 3, after the policy-significance sentence
  - AI 理由: AI says C, marked D. AI reasoning: The sentence about particles including silica shells and preserving a chemical record logically follows the description of particle accumulation and the slow rate of settling, fitting after the millennium-rate sentence in paragraph 2.
### ap_mpzvh9ag_2 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **A** vs AI **B** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'For example, an unexpected sound at night can produce these changes within a few hundred milliseconds, before the listener even identifies the source.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. [■] in paragraph 1, after the opening definition sentence
    - B. [■] in paragraph 2, after the hormone-release sentence
    - C. [■] in paragraph 2, after the heart-rate sentence
    - D. [■] in paragraph 3, after the parasympathetic recovery sentence
  - AI 理由: AI says B, marked A. AI reasoning: The example describes rapid physiological changes (within milliseconds) that occur before identifying the threat, which best fits after the sentence about hormone release that triggers these changes, as it illustrates the speed of the response.
### ap_mpzvh9ag_3 — ✗ 复现（L1: criticalFlags=1）
- **Q3**: 答案键 **C** vs AI **B** (置信 high)
  - 题干: What can be inferred from paragraph 2 about concrete curing?
    - A. Most strength is gained after several years of curing
    - B. Strength gain slows down once the early dense network forms
    - C. Concrete reaches full chemical completion within a few hours
    - D. Sand grains continue to dissolve throughout the entire process
  - AI 理由: AI says B, marked C. AI reasoning: Paragraph 2 indicates that the most rapid changes happen in the first few hours, and the network grows denser, implying strength gain slows after the early dense network forms.
### ap_mq1avi8y_0 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **D** vs AI **C** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'And because oxygen itself was initially toxic to most existing microbes, this shift triggered a mass extinction now known as the Great Oxygenation Event.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1
    - B. Slot 2
    - C. Slot 3
    - D. Slot 4
  - AI 理由: AI says C, marked D. AI reasoning: The sentence about the Great Oxygenation Event logically follows the mention of oxygen accumulation and before the discussion of diversification, fitting best at slot 3.
### ap_mq45tobz_47 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **A** vs AI **B** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For instance, two skaters holding hands stay upright through a crowd that would topple either one alone.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1 (after "...rather than traveling alone.")
    - B. Slot 2 (after "...known as Cooper pairs.")
    - C. Slot 3 (after "...instead of colliding with them.")
    - D. Slot 4 (after "...and resistance vanishes.")
  - AI 理由: AI says B, marked A. AI reasoning: The analogy of skaters holding hands illustrates how pairing provides stability, fitting after the introduction of Cooper pairs.
### ap_gen_routine-20260528-190440_003 — ✗ 复现（L1: criticalFlags=1）
- **Q1**: 答案键 **B** vs AI **A** (置信 high)
  - 题干: The word interrupt in paragraph 3 is closest in meaning to
    - A. delay
    - B. stop
    - C. extend
    - D. review
  - AI 理由: AI says A, marked B. AI reasoning: The passage says 'short funding cycles can interrupt projects before they show clear results.' Interrupt here means to cause a delay or break in progress, not necessarily a permanent stop. 'Delay' is the closest match.
### ap_rt_20260608_1 — ✅ 复审未复现(L1: criticalFlags=1)
### ap_rt_20260608_2 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **B** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For example, a student who lags slightly behind at age ten is not yet sorted into a vocational path that closes off academic routes.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1
    - B. Slot 2
    - C. Slot 3
    - D. Slot 4
  - AI 理由: AI says B, marked C. AI reasoning: The sentence provides an example of how delayed tracking prevents early sorting, which fits after the statement that academic identities are most malleable during common classroom years, at Slot 2.
### ap_mqh11rfu_1 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **D** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For example, when a wave moves from water into a steel hull, only a small fraction of its energy crosses the boundary.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Location 1
    - B. Location 2
    - C. Location 3
    - D. Location 4
  - AI 理由: AI says D, marked C. AI reasoning: The example of water into steel hull illustrates a sharp impedance contrast causing little energy transmission, which fits after the sentence 'When they differ sharply, reflection dominates and very little energy is transmitted.'
### ap_mqh11rfu_2 — ✗ 复现（L1: criticalFlags=2）
- **Q3**: 答案键 **A** vs AI **C** (置信 high)
  - 题干: What does "their" refer to in paragraph 3?
    - A. the ionic lattices
    - B. the covalent solids
    - C. the practical materials
    - D. the textbook categories
  - AI 理由: AI says C, marked A. AI reasoning: In paragraph 3, 'their' refers to 'many practical materials' mentioned in the same sentence: 'many practical materials are mixtures of both bond types and behave in ways that may surprise a chemist relying only on textbook categories.'
- **Q5**: 答案键 **C** vs AI **D** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For example, the bent geometry of a water molecule arises directly from this shared electron arrangement.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Location 1
    - B. Location 2
    - C. Location 3
    - D. Location 4
  - AI 理由: AI says D, marked C. AI reasoning: The sentence about water's bent geometry from shared electron arrangement best fits after the explanation of covalent bonds and shared pairs, which is at Location 4, following 'These shared pairs produce directed, predictable angles between atoms, which is why molecules such as water have such well-defined shapes.'
### ap_mqiq4xsf_0 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **A** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For example, a watch listed at $400 but sold for $150 feels like a bargain, even though its true value may be far lower.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Location 1
    - B. Location 2
    - C. Location 3
    - D. Location 4
  - AI 理由: AI says A, marked C. AI reasoning: The example of a watch listed at $400 but sold for $150 illustrates the concept of anchoring introduced in the first sentence. It fits best at Location 1, after the definition of anchoring.
### ap_routine_20260618190442_001 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **B** vs AI **C** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'And because this obstruction grows stronger as more carbon is added, even small changes in carbon content noticeably alter the metal's behavior.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1
    - B. Slot 2
    - C. Slot 3
    - D. Slot 4
  - AI 理由: AI says C, marked B. AI reasoning: The sentence discusses how adding more carbon strengthens the obstruction and alters behavior, which logically follows the description of carbon atoms lodging between iron atoms and obstructing movement, and before the sentence about adjusting carbon content to produce different steels. Slot 3 is after the description of obstruction and before the mention of adju
### ap_routine_20260618190442_003 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **B** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For example, words that carried personal meaning could still capture a listener's awareness despite being ignored.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Slot 1
    - B. Slot 2
    - C. Slot 3
    - D. Slot 4
  - AI 理由: AI says B, marked C. AI reasoning: The sentence provides an example of unattended input breaking through, which fits after the evidence that unattended input is analyzed more deeply, before the revised theory is introduced.
### ap_mqpnc1vo_0 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **B** vs AI **D** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. 'For example, a single haystack might be painted again and again to track how its color changed from dawn to dusk.' Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Location 1
    - B. Location 2
    - C. Location 3
    - D. Location 4
  - AI 理由: AI says D, marked B. AI reasoning: The sentence about painting a haystack repeatedly to track color changes fits best after the description of the mature Impressionist style (location 4), as it exemplifies the broken brushwork and vivid contrasts mentioned.
### ap_gen_routine-20260707-170236_263145_001 — ✗ 复现（L1: criticalFlags=1）
- **Q5**: 答案键 **C** vs AI **B** (置信 high)
  - 题干: There are four locations [■] in the passage that indicate where the following sentence could be added. **'And because the condenser let the cylinder reuse rather than waste that heat, a Watt engine could perform the same pumping task on a fraction of the coal its predecessor required.'** Where would the sentence best fit? Select a location to add the sentence to the passage.
    - A. Location 1
    - B. Location 2
    - C. Location 3
    - D. Location 4
  - AI 理由: AI says B, marked C. AI reasoning: The sentence explains the benefit of the condenser, which is introduced at location 2. Adding it there logically follows the description of the condenser.

## rdl-long（嫌疑 2: 复现 1 / 未复现 1 / 多解 0 / error 0 / 未跑 0）

### rdl-long_mpvr2ny1_0 — ✅ 复审未复现(L1: criticalFlags=1)
### rdl_long_rt_001 — ✗ 复现（L1: criticalFlags=1）
- **Q3**: 答案键 **C** vs AI **D** (置信 high)
  - 题干: What can be inferred from Riley's email?
    - A. Riley plans to leave the Library Café position soon
    - B. Riley regularly works double shifts on weekend days
    - C. Riley considers Jordan a reliable colleague
    - D. Riley has not yet told the manager about the conflict
  - AI 理由: AI says D, marked C. AI reasoning: Riley says 'Please let me know by Wednesday afternoon so I can update Ms. Tanaka if neither of us is available,' implying that Ms. Tanaka (the manager) has not yet been informed about the conflict.

## ctw（嫌疑 114: 复现 109 / 未复现 5 / 多解 0 / error 0 / 未跑 0）

### ctw_1780330553041_543425 — ✗ 复现（L1: criticalFlags=1）
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `o` 原词 **on** vs AI **of**
### ctw_1780330553042_355059 — ✗ 复现（L1: criticalFlags=2）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `fer` 原词 **fertile** vs AI **ferrous**
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `mu` 原词 **murky** vs AI **muddy**
### ctw_1780330553042_287506 — ✗ 复现（L1: criticalFlags=1）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `swe` 原词 **swells** vs AI **swell**
### ctw_1780330553042_22127 — ✗ 复现（L1: criticalFlags=2）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ha` 原词 **hard** vs AI **have**
### ctw_1780332028250_661363 — ✗ 复现（L1: criticalFlags=1）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `o` 原词 **off** vs AI **on**
### ctw_1780332028250_98338 — ✗ 复现（L1: criticalFlags=1）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **this** vs AI **the**
### ctw_1780351093937_664825 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Th` 原词 **This** vs AI **The**
### ctw_1780351093938_681578 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **their** vs AI **the**
### ctw_1780351093938_160113 — ✅ 复审未复现(L1: criticalFlags=1)
### ctw_1780366577456_647482 — ✗ 复现（L1: criticalFlags=1）
- 空 4 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ra` 原词 **rays** vs AI **radiation**
### ctw_1780366577457_545502 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `sug` 原词 **sugars** vs AI **sugar**
### ctw_1780366577458_445586 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `qui` 原词 **quietly** vs AI **quickly**
### ctw_1780366577458_36427 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `A` 原词 **As** vs AI **approaches**
### ctw_1780366942158_416222 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `prov` 原词 **provides** vs AI **provide**
### ctw_1780366942160_202883 — ✗ 复现（L1: criticalFlags=1）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **the**
### ctw_1780366942160_645201 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `pers` 原词 **personal** vs AI **person's**
### ctw_1780366942161_541625 — ✗ 复现（L1: criticalFlags=2）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `fun` 原词 **fungal** vs AI **fungi**
- 空 3 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `thr` 原词 **through** vs AI **widely**
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `f` 原词 **far** vs AI **from**
### ctw_1780366942162_702937 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **that** vs AI **the**
### ctw_1780367254350_968871 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `a` 原词 **and** vs AI **slowly**
- 空 4 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `res` 原词 **reshape** vs AI **constantly**
- 空 5 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `sur` 原词 **surface** vs AI **reshaping**
- 空 6 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `t` 原词 **the** vs AI **surface**
- 空 7 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `ov` 原词 **over** vs AI **the**
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `o` 原词 **of** vs AI **over**
- 空 9 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `Wh` 原词 **When** vs AI **of**
- 空 10 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `pla` 原词 **plates** vs AI **When**
### ctw_1780367254351_932735 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `fir` 原词 **firmly** vs AI **stick**
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ins` 原词 **insects** vs AI **insect**
### ctw_1780367254352_14184 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **the**
### ctw_1780367254352_130073 — ✗ 复现（L1: criticalFlags=1）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **this** vs AI **the**
### ctw_1780367965582_624780 — ✗ 复现（L1: criticalFlags=1）
- 空 4 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ru` 原词 **rush** vs AI **run**
### ctw_1780367965582_266255 — ✗ 复现（L1: criticalFlags=1）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `cha` 原词 **chasing** vs AI **chase**
### ctw_1780367965584_166957 — ✗ 复现（L1: criticalFlags=1）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `har` 原词 **harmful** vs AI **hardy**
### ctw_1780367965584_27258 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `stre` 原词 **streaming** vs AI **stream**
### ctw_r1_routine-20260531-134653_2 — ✗ 复现（L1: criticalFlags=1）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `smoke` 原词 **smokestacks** vs AI **smoke**
### ctw_r1_routine-20260531-134653_3 — ✗ 复现（L1: criticalFlags=1）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **their** vs AI **the**
### ctw_r1_routine-20260531-134653_6 — ✗ 复现（L1: criticalFlags=2）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `t` 原词 **two** vs AI **the**
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `reser` 原词 **reservoirs** vs AI **reservoir**
### ctw_routine-20260531-184112_1 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `fore` 原词 **forelimb** vs AI **forelegs**
### ctw_routine-20260531-184112_2 — ✗ 复现（L1: criticalFlags=2）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `on` 原词 **once** vs AI **on**
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `re` 原词 **reach** vs AI **require**
### ctw_routine-20260531-184112_5 — ✗ 复现（L1: criticalFlags=2）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `t` 原词 **two** vs AI **the**
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Coo` 原词 **Cooled** vs AI **Cool**
### ctw_r1_routine-20260531-190444_2 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `tis` 原词 **tissues** vs AI **tissue**
- 空 9 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `d` 原词 **die** vs AI **gradually**
- 空 10 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `grad` 原词 **gradually** vs AI **and**
### ctw_1780341431834_674962 — ✗ 复现（L1: criticalFlags=2）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `hea` 原词 **heavier** vs AI **heavy**
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `dr` 原词 **drop** vs AI **drift**
### ctw_1780341431834_211523 — ✗ 复现（L1: criticalFlags=1）
- 空 4 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `wi` 原词 **wild** vs AI **with**
### ctw_1780341431835_197313 — ✗ 复现（L1: criticalFlags=1）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `t` 原词 **two** vs AI **the**
### ctw_1780427578576_154038 — ✗ 复现（L1: criticalFlags=2）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `patt` 原词 **patterns** vs AI **pattern**
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **their** vs AI **the**
- 空 3 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `of` 原词 **often** vs AI **the**
### ctw_1780600357948_883150 — ✗ 复现（L1: criticalFlags=2）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `tis` 原词 **tissues** vs AI **tissue**
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `pro` 原词 **provide** vs AI **produce**
### ctw_1780600357950_187135 — ✗ 复现（L1: criticalFlags=1）
- 空 4 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `la` 原词 **layer** vs AI **land**
- 空 8 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `mate` 原词 **material** vs AI **matter**
### ctw_1780600357950_18067 — ✗ 复现（L1: criticalFlags=2）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `c` 原词 **can** vs AI **could**
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `tis` 原词 **tissues** vs AI **tissue**
### ctw_1780600357951_392015 — ✗ 复现（L1: criticalFlags=1）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **the**
### ctw_r2_routine-r2-20260605-193212_003 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `be` 原词 **beams** vs AI **beam**
### ctw_1780774383040_90221 — ✗ 复现（L1: criticalFlags=1）
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **the**
### ctw_1780774383042_93107 — ✗ 复现（L1: criticalFlags=1）
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `fore` 原词 **forested** vs AI **forest**
### ctw_1780859578651_230387 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `nea` 原词 **nearly** vs AI **near**
### ctw_gen_1780213106900_005 — ✗ 复现（L1: criticalFlags=1）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `eru` 原词 **erupts** vs AI **erupt**
- 空 8 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `dur` 原词 **during** vs AI **gases**
- 空 9 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `acti` 原词 **activity** vs AI **during**
- 空 10 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `erup` 原词 **eruptions** vs AI **activity**
### ctw_gen_1780213106900_009 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Th` 原词 **This** vs AI **The**
### ctw_gen_1780213257230_002 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `sedi` 原词 **sediments** vs AI **sediment**
### ctw_gen_1780213257230_004 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `labo` 原词 **laborers** vs AI **labor**
### ctw_gen_1780213257230_007 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **this** vs AI **the**
### ctw_gen_1780213257230_009 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `flu` 原词 **fluxes** vs AI **flux**
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `disti` 原词 **distinctive** vs AI **distinct**
### ctw_gen_1780213257230_013 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **the**
### ctw_gen_26452870286_002 — ✗ 复现（L1: criticalFlags=2）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **this** vs AI **the**
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **then** vs AI **that**
### ctw_gen_26467805738_003 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **their** vs AI **the**
### ctw_gen_26474365721_002 — ✅ 复审未复现(L1: criticalFlags=1)
### ctw_gen_26474365721_003 — ✗ 复现（L1: criticalFlags=1）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `re` 原词 **react** vs AI **retina**
- 空 6 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `li` 原词 **light** vs AI **react**
- 空 7 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `ce` 原词 **cells** vs AI **light**
- 空 8 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `sig` 原词 **signals** vs AI **cells**
- 空 9 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `t` 原词 **the** vs AI **signals**
- 空 10 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `wh` 原词 **which** vs AI **the**
### ctw_gen_26527192867_002 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Th` 原词 **This** vs AI **The**
### ctw_gen_26538316681_008 — ✗ 复现（L1: criticalFlags=2）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ma` 原词 **math** vs AI **materials**
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **their**
### ctw_gen_routine-20260528-061913_005 — ✗ 复现（L1: criticalFlags=1）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **this** vs AI **the**
### ctw_gen_routine-20260528-082414_003 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `a` 原词 **age** vs AI **and**
### ctw_gen_routine-20260528-170909_005 — ✅ 复审未复现(L1: criticalFlags=1)
### ctw_gen_routine-20260528-170930_005 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `wa` 原词 **waves** vs AI **ocean**
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `a` 原词 **as** vs AI **and**
### ctw_gen_routine-20260528-190440_003 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `i` 原词 **in** vs AI **it**
### ctw_gen_routine-20260528-190440_004 — ✗ 复现（L1: criticalFlags=1）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `wi` 原词 **wires** vs AI **wire**
### ctw_1780859598115_205161 — ✗ 复现（L1: criticalFlags=2）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **this** vs AI **their**
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `gra` 原词 **grasses** vs AI **grass**
### ctw_1780859598116_584203 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ro` 原词 **round** vs AI **rocky**
### ctw_r1_4 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `a` 原词 **as** vs AI **and**
### ctw_r1_routine-20260529-170842_5 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `op` 原词 **opens** vs AI **open**
### ctw_r1_routine-20260529-170842_6 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `orb` 原词 **orbits** vs AI **orbit**
### ctw_r1_routine-20260529-181143_5 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ro` 原词 **rock** vs AI **rocks**
### ctw_r1_routine-20260529-190441_1 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ke` 原词 **keeps** vs AI **keep**
### ctw_r1_routine-20260529-190441_3 — ✗ 复现（L1: criticalFlags=1）
- 空 4 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `mo` 原词 **most** vs AI **motivate**
### ctw_r1_routine-20260530-190521_5 — ✗ 复现（L1: criticalFlags=1）
- 空 4 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `pa` 原词 **parts** vs AI **particles**
### ctw_rt_20260608_1 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **the**
### ctw_rt_20260608_3 — ✗ 复现（L1: criticalFlags=2）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Bel` 原词 **Belief** vs AI **Beliefs**
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `expec` 原词 **expectation** vs AI **expectations**
### ctw_rt_20260608_5 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `pla` 原词 **planet's** vs AI **plate**
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `pul` 原词 **pulling** vs AI **pulled**
### ctw_rt_20260608_6 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `ra` 原词 **rays** vs AI **radiation**
### ctw_gen_27310393453_001 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **the**
### ctw_gen_27310393453_004 — ✗ 复现（L1: criticalFlags=1）
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `sys` 原词 **systems** vs AI **system**
### ctw_gen_27310393453_005 — ✗ 复现（L1: criticalFlags=1）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `t` 原词 **two** vs AI **the**
- 空 4 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `a` 原词 **and** vs AI **folds**
### ctw_gen_27310393453_008 — ✗ 复现（L1: criticalFlags=2）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `tele` 原词 **telegraph** vs AI **telephone**
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `conn` 原词 **connected** vs AI **connecting**
### ctw_gen_27445812820_002 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `rele` 原词 **released** vs AI **release**
### ctw_gen_27445812820_005 — ✗ 复现（L1: criticalFlags=1）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `hea` 原词 **heating** vs AI **heat**
### ctw_gen_27480038600_005 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `miner` 原词 **mineral-rich** vs AI **mineral**
### ctw_gen_27513159145_001 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Th` 原词 **This** vs AI **the**
### ctw_gen_27580831758_003 — ✗ 复现（L1: criticalFlags=1）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `su` 原词 **surge** vs AI **surges**
### ctw_gen_27580831758_004 — ✗ 复现（L1: criticalFlags=1）
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `popul` 原词 **populations** vs AI **population**
### ctw_gen_27580831758_008 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `techno` 原词 **technologies** vs AI **technology**
### ctw_1781637548131_642108 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `sev` 原词 **several** vs AI **seven**
- 空 9 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `met` 原词 **meters** vs AI **hundred**
### ctw_1781637548131_742758 — ✗ 复现（L1: criticalFlags=1）
- 空 1 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `mido` 原词 **mid-ocean** vs AI **ocean**
- 空 3 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `ri` 原词 **rises** vs AI **rock**
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `dive` 原词 **diverging** vs AI **divergent**
### ctw_routine_3 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `sp` 原词 **spots** vs AI **space**
### ctw_routine_5 — ✗ 复现（L1: criticalFlags=1）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `dr` 原词 **drag** vs AI **drive**
- 空 7 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `o` 原词 **of** vs AI **sea**
- 空 8 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `s` 原词 **sea** vs AI **Deep**
- 空 9 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `Dee` 原词 **Deeper** vs AI **however**
- 空 10 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `how` 原词 **however** vs AI **sea**
### ctw_routine_6 — ✗ 复现（L1: criticalFlags=1）
- 空 7 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `floa` 原词 **floating** vs AI **tiny**
- 空 8 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `o` 原词 **of** vs AI **floating**
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `o` 原词 **or** vs AI **of**
### ctw_1781813465532_163247 — ✗ 复现（L1: criticalFlags=1）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `on` 原词 **onto** vs AI **on**
### ctw_1781813465532_971327 — ✗ 复现（L1: criticalFlags=1）
- 空 6 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `tra` 原词 **trapped** vs AI **trace**
### ctw_1781813469053_18473 — ✗ 复现（L1: criticalFlags=1）
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `t` 原词 **the** vs AI **their**
### ctw_1781813469055_146472 — ✗ 复现（L1: criticalFlags=1）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **these** vs AI **the**
### ctw_1782158798669_53203 — ✗ 复现（L1: criticalFlags=1）
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `sha` 原词 **shaded** vs AI **shade**
### ctw_1782158798669_812489 — ✅ 复审未复现(L1: criticalFlags=2)
### ctw_1782158798671_769268 — ✗ 复现（L1: criticalFlags=1）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `var` 原词 **varies** vs AI **vary**
### ctw_1782331802554_202619 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Th` 原词 **These** vs AI **they**
### ctw_1782331802554_361833 — ✗ 复现（L1: criticalFlags=2）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `thunde` 原词 **thundercloud** vs AI **thunderstorm**
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `a` 原词 **air** vs AI **and**
- 空 6 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `a` 原词 **and** vs AI **positive**
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `cha` 原词 **charges** vs AI **charge**
### ctw_1782331802556_53564 — ✅ 复审未复现(L1: criticalFlags=1)
### ctw_1782590704878_611271 — ✗ 复现（L1: criticalFlags=1）
- 空 9 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Tu` 原词 **Tube** vs AI **Tubeworms**
### ctw_1782590704880_515919 — ✗ 复现（L1: criticalFlags=1）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `scho` 原词 **schooling** vs AI **school**
### ctw_1782590704880_633770 — ✗ 复现（L1: criticalFlags=2）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `c` 原词 **cut** vs AI **came**
- 空 10 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `buil` 原词 **builders** vs AI **building**
### ctw_1782763543353_957015 — ✗ 复现（L1: criticalFlags=1）
- 空 5 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `str` 原词 **strand** vs AI **string**
### ctw_1782763543356_465582 — ✗ 复现（L1: criticalFlags=1）
- 空 2 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `sl` 原词 **slow** vs AI **slight**
### ctw_1783466785247_519484 — ✗ 复现（L1: criticalFlags=1）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `t` 原词 **the** vs AI **this**
### ctw_1783466785248_559673 — ✗ 复现（L1: criticalFlags=1）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `be` 原词 **below** vs AI **beneath**
### ctw_1783466785248_560516 — ✗ 复现（L1: criticalFlags=2）
- 空 3 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `fa` 原词 **faint** vs AI **far**
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `brig` 原词 **brighter** vs AI **bright**
- 空 9 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `st` 原词 **stars** vs AI **host**
### ctw_1783545173662_655182 — ✗ 复现（L1: criticalFlags=1）
- 空 8 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `Th` 原词 **This** vs AI **the**
### ctw_1783545173664_483335 — ✗ 复现（L1: criticalFlags=1）
- 空 7 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `th` 原词 **that** vs AI **the**
### ctw_1783545173665_989726 — ✗ 复现（L1: criticalFlags=1）
- 空 1 [**critical: AI 词吻合词首碎片→多解嫌疑**]: 碎片 `fo` 原词 **form** vs AI **fossils**
- 空 4 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `i` 原词 **is** vs AI **animal**
- 空 5 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `bur` 原词 **buried** vs AI **is**
- 空 6 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `m` 原词 **mud** vs AI **buried**
- 空 7 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `o` 原词 **or** vs AI **mud**
- 空 8 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `a` 原词 **ash** vs AI **or**
- 空 9 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `lo` 原词 **long** vs AI **volcanic**
- 空 10 [info: AI 词不合碎片(模型答错, 非题目问题)]: 碎片 `mine` 原词 **minerals** vs AI **long**

## lat（嫌疑 27: 复现 21 / 未复现 5 / 多解 1 / error 0 / 未跑 0）

### lat_mpveuehx_1 — ✅ 复审未复现(L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer")
### lat_mpveuehx_2 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **B** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What will the professor most likely discuss in the next class?
    - A. How engineers reduce unwanted noise from passing vehicles
    - B. How astronomers use the Doppler effect on light from galaxies
    - C. How the human ear physically detects and separates pitches
    - D. How the speed of sound changes in different kinds of air
  - AI 理由: The professor concludes: 'In our next class, we'll look at how astronomers apply the Doppler effect to light from distant galaxies.' Option D matches this preview.
### lat_mpveuehx_3 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **C** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: Why does the professor mention that the orchids are rare and widely scattered?
    - A. To suggest that the orchids are now in danger of extinction
    - B. To restate simply that the deceptive orchids are not common
    - C. To show why the deception keeps working on the pollinators
    - D. To argue that rare plants always attract the most pollinators
  - AI 理由: The professor states that the orchids are rare and widely scattered so that pollinators do not learn to avoid them, which is why the deception continues to work.
### lat_mpvr2nyb_2 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **B** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What can be inferred from the fact that authorities viewed coffee houses with suspicion?
    - A. Coffee houses were eventually shut down all across Europe
    - B. The open debate in coffee houses could challenge those in power
    - C. Most customers went there only to read official announcements
    - D. Authorities preferred that people gather in taverns instead
  - AI 理由: Authorities worried coffee houses were 'breeding grounds for criticism of the government,' implying open debate could challenge those in power.
### lat_mpvr2nyb_6 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **C** vs AI **B**; 评级 {"A":"invalid","B":"valid","C":"invalid","D":"invalid"}
  - 题干: What does the professor imply about children learning language?
    - A. They simply copy the sentences they hear from adults
    - B. They learn grammar faster when adults correct every error
    - C. They actively work out the rules of language themselves
    - D. They cannot master irregular verbs until adulthood
  - AI 理由: The professor implies that children actively construct grammar by forming hypotheses, as shown by overgeneralization, not that they simply copy, learn faster with correction, or cannot master irregular verbs until adulthood.
### lat_mpw0aj52_1 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **A** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What will the professor most likely discuss next?
    - A. Retrieval practice and how self-testing strengthens spaced study
    - B. How to redesign university courses around the spacing effect
    - C. The details of Ebbinghaus's nonsense-syllable experiments
    - D. Why cramming remains popular despite its known weaknesses
  - AI 理由: The professor concludes by saying 'next time, we'll look at a related technique—retrieval practice—and how testing yourself, rather than rereading, can make these spaced sessions even more powerful.' Option D matches this preview, while A, B, and C are not indicated.
### lat_mpw0aj52_2 — ✅ 复审未复现(L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer")
### lat_mpw0aj52_4 — ✅ 复审未复现(L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer")
### lat_mpw0aj52_5 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **B** vs AI **C**; 评级 {"A":"invalid","B":"invalid","C":"valid","D":"invalid"}
  - 题干: What does the professor imply about tidal locking in the solar system?
    - A. It is a rare event unique to the Earth and its Moon
    - B. It is a widespread result of gravity affecting many moons
    - C. It happens only to moons that have stopped rotating entirely
    - D. It occurs more quickly for moons farther from their planet
  - AI 理由: The professor implies tidal locking is common, stating it is 'not unique' and 'common throughout the solar system,' so it is widespread.
### lat_mpw0aj52_6 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **B** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What does the professor imply about individuals acting in their own self-interest?
    - A. It always produces the best outcome for the whole community
    - B. It can lead to outcomes that harm everyone, including themselves
    - C. It is the only rational way to manage any shared resource
    - D. It matters less than the total number of people involved
  - AI 理由: The professor implies that individual rationality can lead to collective ruin, meaning self-interest can harm everyone, including the individual.
### lat_mpw0icjp_6 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q3** 答案不一致: 答案键 **B** vs AI **C**; 评级 {"A":"invalid","B":"invalid","C":"valid","D":"invalid"}
  - 题干: What does the professor say about the horseshoe crab?
    - A. It is one of the best index fossils available
    - B. It makes a poor index fossil because it changed little
    - C. It lived for only a few million years
    - D. It is found only on a single continent
  - AI 理由: The professor says the horseshoe crab has barely changed over hundreds of millions of years, making it a poor index fossil.
### lat_mpw0p1fq_3 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **C** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What will the professor most likely discuss next?
    - A. More historical studies on the origins of the risky shift
    - B. How individuals make decisions when completely alone
    - C. Techniques groups can use to avoid polarization
    - D. Why committees should be abolished in favor of single leaders
  - AI 理由: The professor concludes by saying 'Next time, we'll look at what techniques groups can use to guard against this and reach more balanced decisions,' which matches option D. The other options are not previewed.
### lat_r1_routine-20260531-134653_2 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **A** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What does the professor imply about the Andes?
    - A. Their rock types and shape reflect a subduction zone rather than a continental collision
    - B. They are growing at a faster rate than the Himalayas
    - C. They are formed mainly by two oceanic plates moving apart
    - D. They will eventually become as tall as the Himalayas
  - AI 理由: The professor implies the Andes formed through subduction (oceanic plate descending), which differs from continental collision, so their rock types and shape reflect that process.
### lat_r1_routine-20260531-134653_3 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **B** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What does the professor imply about how anthropologists today typically explain a particular taboo?
    - A. They usually accept the functional/ecological explanation without further analysis
    - B. They generally consider several factors and weight them differently from case to case
    - C. They prefer to interpret taboos primarily as misunderstandings of nutrition
    - D. They mostly view taboos as transient phenomena that disappear over a single generation
  - AI 理由: The professor states that contemporary anthropologists 'combine these approaches' and that 'the relative weight of each layer changes from case to case,' implying they consider multiple factors and weigh them differently.
### lat_r1_routine-20260531-134653_4 — ✅ 复审未复现(L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer")
### lat_r1_routine-20260531-190444_3 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **B** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: Why does the professor describe sequestration as a balance rather than a one-way process?
    - A. To indicate that mature forests stop sequestering carbon at predictable ages
    - B. To emphasize that gains can be reversed by disturbances within the same forest
    - C. To argue that soil pools always outweigh the above-ground carbon storage
    - D. To suggest that forests are now expanding faster than they are being lost
  - AI 理由: The professor describes sequestration as a balance because gains from carbon storage can be reversed by disturbances like fires, harvesting, or plowing. Option D correctly identifies this function. Options A, B, and C are not supported by the lecture.
### lat_mpx0wcrn_3 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **C** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: According to the professor, why do race-car drivers specifically train their necks?
    - A. To improve their reaction time during emergency braking
    - B. To reduce the risk of damaging hearing in loud environments
    - C. To overcome their own inertia when turning their head at speed
    - D. To stay alert during long endurance races
  - AI 理由: The professor explains that turning the head against inertia requires strength at high speeds, which is why race-car drivers train their necks.
### lat_mpygexgm_1 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **A** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: According to the professor, why did composers reharmonize folk melodies?
    - A. To make a regional sound carry the prestige of concert tradition
    - B. To document folk songs accurately for later musicologists
    - C. To preserve the original village singing style intact
    - D. To imitate the Austro-German classical canon directly
  - AI 理由: The professor says reharmonization was done 'to make a familiar, regionally specific sound carry the prestige of European concert tradition.'
### lat_mq1b7gji_3 — ✅ 复审未复现(L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer")
### lat_rt_002 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **A** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What does the professor imply about the appearance of clearer water in zebra-mussel-affected lakes?
    - A. It can mask serious underlying ecological damage
    - B. It permanently improves drinking water in nearby cities
    - C. It encourages tourists to visit affected lake shorelines
    - D. It indicates that lake ecosystems are returning to health
  - AI 理由: The professor implies that clearer water is misleading because it results from the removal of plankton, which causes fish populations to collapse, indicating ecological damage rather than health.
### lat_rt_004 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **C** vs AI **B**; 评级 {"A":"invalid","B":"valid","C":"invalid","D":"invalid"}
  - 题干: What does the professor imply about modern designs that ignore local climate?
    - A. They generally cost less than vernacular construction methods
    - B. They eventually replace vernacular buildings in tropical regions
    - C. They often perform worse than vernacular buildings in the same climate
    - D. They demonstrate that climate considerations matter less than aesthetic ones
  - AI 理由: The professor implies that modern designs ignoring local climate are less efficient, as vernacular buildings are 'often more efficiently' adapted.
### lat_mqpnc21l_3 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **C** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What does the professor imply about why cities offer incentives for green roofs?
    - A. Cities mainly want to create habitat for insects and birds
    - B. Cities believe green roofs will fully replace traditional drains
    - C. Cities value the stormwater benefit most when deciding to encourage them
    - D. Cities install green roofs chiefly to cool the buildings beneath them
  - AI 理由: The professor states that the stormwater benefit often convinces cities to offer incentives, implying it is the primary reason.
### lat_mqsic4p3_2 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **B** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: Why does the professor mention a distracted driver and a radiologist?
    - A. To restate that the gorilla study used a video
    - B. To show that inattentional blindness has real-world consequences
    - C. To argue that drivers and doctors have unusually poor vision
    - D. To suggest that attention can never be trained or improved
  - AI 理由: The professor uses the driver and radiologist examples to illustrate that inattentional blindness has real-world consequences beyond the lab.
### lat_mqsic4p3_3 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **C** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What will the professor most likely discuss next?
    - A. The specific routes that canoes follow between islands
    - B. How shell ornaments are passed down within families
    - C. What happens when expectations of reciprocity are broken
    - D. Why Marcel Mauss chose to study traditional societies
  - AI 理由: The professor ends by saying 'Next time, we'll look at what happens when these expectations of reciprocity are broken,' so option D is the correct prediction. Options A, B, and C are not mentioned as future topics.
### lat_mqwshaw7_1 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **A** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What does the professor imply about mirror neurons and empathy?
    - A. They likely contribute to empathy but do not fully explain it
    - B. They are the single complete cause of all human empathy
    - C. They prevent people from understanding others' emotions
    - D. They are found only in monkeys and not in human brains
  - AI 理由: The professor states that mirror neurons likely contribute to empathy but are not the whole story, and scientists debate how much they explain. Option D correctly infers this. Option B is too absolute, and A and C are opposite of the lecture.
### lat_mqzndtxs_1 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q4** 答案不一致: 答案键 **A** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"invalid","D":"valid"}
  - 题干: What does the professor imply about urban ecosystems?
    - A. They can develop into communities unlike those of the surrounding region
    - B. They will eventually become identical to nearby rural ecosystems
    - C. They are harmed only by the rising cost of cooling buildings
    - D. They support fewer total insect species than rural areas do
  - AI 理由: The professor implies urban ecosystems create novel communities that don't match anything in the surrounding region, not that they become identical or are harmed only by costs.
### lat_mrba2qtn_1 — ✗ 多解嫌疑（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q3** 多解嫌疑: 答案键 **D** vs AI **D**; 评级 {"A":"invalid","B":"valid","C":"invalid","D":"valid"}
  - 题干: Why does the professor mention that some folk themes were actually invented?
    - A. To criticize composers for deceiving their concert audiences
    - B. To note that certain melodies were newly composed
    - C. To argue that authentic folk songs had no real value
    - D. To show that the feeling of identity mattered more than authenticity
  - AI 理由: The professor mentions invented folk themes to illustrate that the feeling of national identity mattered more than strict authenticity, not to criticize or argue about value.

## la（嫌疑 4: 复现 1 / 未复现 2 / 多解 1 / error 0 / 未跑 0）

### la_mpvfq0rz_6 — ✅ 复审未复现(L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer")
### la_mpw0aj50_1 — ✗ 多解嫌疑（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q2** 多解嫌疑: 答案键 **D** vs AI **D**; 评级 {"A":"invalid","B":"invalid","C":"valid","D":"valid"}
  - 题干: Why does the speaker mention the café in the library annex?
    - A. Because it is replacing the dining hall in fall
    - B. Because it offers cheaper meals than the dining hall
    - C. Because it extends its hours for the summer
    - D. Because the dining hall no longer serves lunch
  - AI 理由: The speaker mentions the café because the dining hall will not serve lunch during summer, so the café provides a midday meal option. Option D directly states this. Option C is not stated (hours not mentioned). Options A and B are not supported.
### la_v2_1780214182199_003 — ✅ 复审未复现(L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer")
### la_mqh1b5mi_0 — ✗ 复现（L1: {"questionIndex":0,"match":true,"ambiguous":false,"aiAnswer"）
- **Q2** 答案不一致: 答案键 **C** vs AI **A**; 评级 {"A":"valid","B":"invalid","C":"valid","D":"invalid"}
  - 题干: What can be inferred from the announcement?
    - A. The projection equipment cannot operate when natural light is still strong
    - B. Snack tables will remain closed during the film projection itself
    - C. The screening time will not change even if there is rain
    - D. The featured documentary will be shown only to graduate students
  - AI 理由: The announcement says the projection begins 'once natural light fades,' implying the equipment requires darkness. Option C is also valid because the start time remains the same if moved indoors, but A is a stronger inference directly tied to the equipment's operation.

## lcr（嫌疑 8: 复现 6 / 未复现 0 / 多解 2 / error 0 / 未跑 0）

### lcr_mpw0aj59_2 — ✗ 复现（L1: ）
### lcr_mpw0aj59_4 — ✗ 复现（L1: ）
### lcr_mpw1ilch_1 — ✗ 复现（L1: ）
### lcr_mpw1ilch_7 — ✗ 多解嫌疑（L1: ）
### lcr_mpx0wcrw_4 — ✗ 复现（L1: ）
### lcr_rt_001 — ✗ 复现（L1: ）
### lcr_rt_005 — ✗ 复现（L1: ）
### lcr_mrckqvxq_7 — ✗ 多解嫌疑（L1: ）

**状态：复审全部完成。**
