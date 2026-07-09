# CTW 唯一解复核报告 — 2026-07-09

范围: L1 嫌疑 114 题 · 已复核 114 · error 0
多解题数: 87 · 第二解按类: 屈折 37 / 功能词 39 / 内容近义 51

## 处置口径
- **屈折变体**（sugar/sugars）: 判分应接受等价形式 → 已进 `ctw-accepted-words-patch.json`，`--apply-inflections` 一键落 accepted_words。
- **功能词短碎片**（on/of, the/this）: 真题靠上下文锁死；我们这些锁不住 → 建议生成器换词重挖（不宜只放宽判分，否则失去区分度）。清单见下，标 `function`。
- **内容近义**（murky/muddy）: 逐个看语境能否锁定；锁不住重挖或补 accepted_words。清单标 `content`。

## 多解明细

### ctw_1780330553041_543425 — biology/symbiosis
- 空 10 碎片`o` 原词 **on** ← 第二解: of(function)
### ctw_1780330553042_355059 — environmental_science/water purification
- 空 2 碎片`fer` 原词 **fertile** ← 第二解: ferrous(content)
- 空 7 碎片`mu` 原词 **murky** ← 第二解: muddy(content)
### ctw_1780330553042_287506 — history/maritime navigation
- 空 5 碎片`swe` 原词 **swells** ← 第二解: swell(inflection)
### ctw_1780330553042_22127 — astronomy/lunar geology
- 空 2 碎片`i` 原词 **its** ← 第二解: in(function)
- 空 3 碎片`fa` 原词 **face** ← 第二解: faces(inflection)
- 空 7 碎片`ha` 原词 **hard** ← 第二解: have(function)
### ctw_1780332028250_661363 — biology/animal hibernation
- 空 5 碎片`o` 原词 **off** ← 第二解: on(function)
### ctw_1780332028250_98338 — astronomy/star life cycle
- 空 2 碎片`th` 原词 **this** ← 第二解: the(function)
### ctw_1780351093937_664825 — biology/deep sea organisms
- 空 8 碎片`Th` 原词 **This** ← 第二解: The(function)
### ctw_1780351093938_160113 — history/writing systems
- 空 3 碎片`pict` 原词 **pictures** ← 第二解: pictographs(content)
- 空 6 碎片`tr` 原词 **trade** ← 第二解: transactions(content)
- 空 9 碎片`th` 原词 **these** ← 第二解: the(function)
### ctw_1780366577456_647482 — environmental_science/ozone layer
- 空 4 碎片`ra` 原词 **rays** ← 第二解: radiation(content)
### ctw_1780366577457_545502 — environmental_science/carbon cycle
- 空 6 碎片`sug` 原词 **sugars** ← 第二解: sugar(inflection)
### ctw_1780366942158_416222 — biology/symbiosis in coral reefs
- 空 9 碎片`prov` 原词 **provides** ← 第二解: provide(inflection)
### ctw_1780366942160_202883 — environmental_science/tropical deforestation
- 空 2 碎片`th` 原词 **these** ← 第二解: the(function)
### ctw_1780366942160_645201 — psychology/conformity in groups
- 空 8 碎片`pers` 原词 **personal** ← 第二解: person's(content)
### ctw_1780366942161_541625 — biology/mutualism between fungi and plant roots
- 空 1 碎片`fun` 原词 **fungal** ← 第二解: fungi(content)
- 空 7 碎片`f` 原词 **far** ← 第二解: from(function)
### ctw_1780367254352_130073 — astronomy/formation of stars
- 空 2 碎片`th` 原词 **this** ← 第二解: the(function)
### ctw_1780367965582_624780 — environmental_science/green roofs in cities
- 空 2 碎片`rain` 原词 **rainwater** ← 第二解: rainfall(content)
- 空 4 碎片`ru` 原词 **rush** ← 第二解: run(content)
- 空 7 碎片`floo` 原词 **flooding** ← 第二解: floods(content)
### ctw_1780367965584_166957 — environmental_science/wetland water filtration
- 空 4 碎片`m` 原词 **mud** ← 第二解: muck(content)
- 空 9 碎片`th` 原词 **thick** ← 第二解: thin(content)
### ctw_1780367965584_27258 — astronomy/auroras and solar wind
- 空 3 碎片`stre` 原词 **streaming** ← 第二解: stream(inflection)
### ctw_r1_routine-20260531-134653_3 — psychology/language acquisition
- 空 1 碎片`th` 原词 **their** ← 第二解: the(function)
### ctw_r1_routine-20260531-134653_6 — astronomy/comets
- 空 2 碎片`t` 原词 **two** ← 第二解: the(function)
- 空 3 碎片`reser` 原词 **reservoirs** ← 第二解: reservoir(inflection)
### ctw_routine-20260531-184112_1 — biology/marine biology
- 空 6 碎片`fore` 原词 **forelimb** ← 第二解: forelimbs(inflection)
### ctw_routine-20260531-184112_2 — environmental_science/invasive species
- 空 8 碎片`re` 原词 **reach** ← 第二解: require(content)
### ctw_routine-20260531-184112_5 — geology/ocean floor
- 空 3 碎片`under` 原词 **underwater** ← 第二解: undersea(content)
- 空 8 碎片`Coo` 原词 **Cooled** ← 第二解: Cool(inflection)
### ctw_r1_routine-20260531-190444_2 — environmental_science/carbon cycle
- 空 6 碎片`tis` 原词 **tissues** ← 第二解: tissue(inflection)
### ctw_1780341431834_674962 — environmental_science/water purification
- 空 5 碎片`hea` 原词 **heavier** ← 第二解: heavy(content)
- 空 7 碎片`dr` 原词 **drop** ← 第二解: drops(inflection), drifts(content)
### ctw_1780341431834_211523 — history/agricultural revolution
- 空 4 碎片`wi` 原词 **wild** ← 第二解: with(function)
### ctw_1780341431835_197313 — geology/mountain formation
- 空 1 碎片`t` 原词 **two** ← 第二解: the(function)
### ctw_1780427578576_154038 — biology/animal camouflage
- 空 1 碎片`patt` 原词 **patterns** ← 第二解: pattern(inflection)
- 空 2 碎片`th` 原词 **their** ← 第二解: the(function)
### ctw_1780600357948_883150 — biology/coral reefs
- 空 9 碎片`tis` 原词 **tissues** ← 第二解: tissue(inflection)
- 空 10 碎片`pro` 原词 **provide** ← 第二解: produce(content)
### ctw_1780600357950_187135 — environmental_science/permafrost melting
- 空 2 碎片`ca` 原词 **cause** ← 第二解: causes(inflection)
### ctw_1780600357951_392015 — astronomy/star formation
- 空 7 碎片`th` 原词 **these** ← 第二解: the(function)
### ctw_r2_routine-r2-20260605-193212_003 — astronomy/pulsars
- 空 9 碎片`be` 原词 **beams** ← 第二解: beam(inflection)
### ctw_1780774383040_90221 — biology/anglerfish bioluminescence
- 空 10 碎片`th` 原词 **these** ← 第二解: the(function)
### ctw_1780774383042_93107 — environmental_science/wildlife corridors
- 空 10 碎片`fore` 原词 **forested** ← 第二解: forest(inflection)
### ctw_1780859578651_230387 — geology/Chicxulub impact
- 空 8 碎片`nea` 原词 **nearly** ← 第二解: near(content)
### ctw_gen_1780213106900_005 — geology/volcanism
- 空 5 碎片`eru` 原词 **erupts** ← 第二解: erupt(inflection)
### ctw_gen_1780213257230_002 — environmental_science/water purification
- 空 3 碎片`sedi` 原词 **sediments** ← 第二解: sediment(inflection)
### ctw_gen_1780213257230_004 — history/colonial trade
- 空 6 碎片`labo` 原词 **laborers** ← 第二解: labor(content)
### ctw_gen_1780213257230_007 — anthropology/stone age trade
- 空 9 碎片`th` 原词 **this** ← 第二解: the(function)
- 空 10 碎片`trav` 原词 **traveled** ← 第二解: travelled(content)
### ctw_gen_1780213257230_009 — art/pottery glazing
- 空 3 碎片`flu` 原词 **fluxes** ← 第二解: flux(inflection)
- 空 9 碎片`disti` 原词 **distinctive** ← 第二解: distinct(content)
### ctw_gen_26452870286_002 — environmental_science/the carbon cycle
- 空 6 碎片`th` 原词 **this** ← 第二解: the(function)
- 空 10 碎片`th` 原词 **then** ← 第二解: that(function)
### ctw_gen_26474365721_003 — psychology/color perception
- 空 5 碎片`re` 原词 **react** ← 第二解: respond(content)
### ctw_gen_26527192867_002 — environmental_science/deforestation
- 空 6 碎片`Th` 原词 **This** ← 第二解: The(function)
### ctw_gen_26538316681_008 — technology/engineering
- 空 10 碎片`th` 原词 **these** ← 第二解: their(function)
### ctw_gen_routine-20260528-061913_005 — geology/volcanism
- 空 1 碎片`th` 原词 **this** ← 第二解: the(function)
### ctw_gen_routine-20260528-082414_003 — psychology/social behavior
- 空 8 碎片`a` 原词 **age** ← 第二解: and(function)
### ctw_gen_routine-20260528-170930_005 — geology/erosion
- 空 9 碎片`a` 原词 **as** ← 第二解: and(function)
### ctw_gen_routine-20260528-190440_004 — history/telegraph history
- 空 2 碎片`wi` 原词 **wires** ← 第二解: wire(inflection)
### ctw_1780859598115_205161 — environmental_science/soil erosion
- 空 2 碎片`th` 原词 **this** ← 第二解: their(function)
- 空 10 碎片`gra` 原词 **grasses** ← 第二解: grass(inflection)
### ctw_1780859598116_584203 — geology/meteor impacts
- 空 3 碎片`ro` 原词 **round** ← 第二解: rock(content)
### ctw_r1_4 — history/ancient Egypt
- 空 3 碎片`a` 原词 **as** ← 第二解: and(function)
### ctw_r1_routine-20260529-170842_5 — geology/cave formation
- 空 6 碎片`op` 原词 **opens** ← 第二解: open(inflection)
### ctw_r1_routine-20260529-170842_6 — astronomy/satellite technology
- 空 3 碎片`orb` 原词 **orbits** ← 第二解: orbit(inflection)
### ctw_r1_routine-20260529-190441_1 — biology/cell biology
- 空 6 碎片`ke` 原词 **keeps** ← 第二解: keep(inflection)
### ctw_r1_routine-20260529-190441_3 — psychology/motivation
- 空 4 碎片`mo` 原词 **most** ← 第二解: motivate(content)
### ctw_r1_routine-20260530-190521_5 — geology/minerals
- 空 4 碎片`pa` 原词 **parts** ← 第二解: particles(content)
### ctw_rt_20260608_3 — psychology/placebo effect
- 空 3 碎片`resp` 原词 **response** ← 第二解: responses(inflection)
- 空 9 碎片`Bel` 原词 **Belief** ← 第二解: Beliefs(inflection)
- 空 10 碎片`expec` 原词 **expectation** ← 第二解: expectations(inflection)
### ctw_rt_20260608_5 — geology/ocean floor
- 空 8 碎片`pla` 原词 **planet's** ← 第二解: plate(content)
- 空 10 碎片`pul` 原词 **pulling** ← 第二解: pulled(content)
### ctw_rt_20260608_6 — astronomy/planetary atmospheres
- 空 3 碎片`th` 原词 **that** ← 第二解: the(function)
- 空 9 碎片`ra` 原词 **rays** ← 第二解: radiation(content)
### ctw_gen_27310393453_001 — biology/marine biology
- 空 8 碎片`th` 原词 **these** ← 第二解: the(function)
### ctw_gen_27310393453_004 — history/ancient astronomy
- 空 10 碎片`sys` 原词 **systems** ← 第二解: system(inflection)
### ctw_gen_27310393453_008 — technology/telecommunications
- 空 2 碎片`tele` 原词 **telegraph** ← 第二解: telephone(content), television(content)
- 空 4 碎片`tele` 原词 **telephone** ← 第二解: telegraph(content), television(content)
- 空 5 碎片`conn` 原词 **connected** ← 第二解: connecting(content)
- 空 9 碎片`fi` 原词 **fiber** ← 第二解: fibre(content)
### ctw_gen_27445812820_002 — environmental_science/ozone layer
- 空 8 碎片`rele` 原词 **released** ← 第二解: release(inflection)
### ctw_gen_27445812820_005 — geology/geysers
- 空 4 碎片`under` 原词 **underlying** ← 第二解: underground(content)
### ctw_gen_27480038600_005 — geology/formation of minerals
- 空 3 碎片`co` 原词 **cools** ← 第二解: cool(inflection)
- 空 8 碎片`miner` 原词 **mineral-rich** ← 第二解: mineral(content)
### ctw_gen_27513159145_001 — biology/migratory patterns of monarch butterflies
- 空 6 碎片`Th` 原词 **This** ← 第二解: The(function)
### ctw_gen_27580831758_008 — technology/electrical grids
- 空 8 碎片`techno` 原词 **technologies** ← 第二解: technology(inflection)
### ctw_1781637548131_642108 — history/Roman engineering
- 空 8 碎片`sev` 原词 **several** ← 第二解: seven(content)
### ctw_routine_3 — acoustics/sound waves
- 空 9 碎片`sp` 原词 **spots** ← 第二解: space(content)
### ctw_routine_5 — oceanography/ocean currents
- 空 5 碎片`dr` 原词 **drag** ← 第二解: drive(content)
- 空 9 碎片`Dee` 原词 **Deeper** ← 第二解: Deep(content)
### ctw_routine_6 — meteorology/cloud formation
- 空 9 碎片`o` 原词 **or** ← 第二解: of(function)
### ctw_1781813465532_163247 — geology/formation of sedimentary rock
- 空 3 碎片`tow` 原词 **toward** ← 第二解: towards(inflection)
### ctw_1781813469053_18473 — biology/bioluminescence in deep-sea creatures
- 空 3 碎片`cal` 原词 **called** ← 第二解: calls(content)
- 空 10 碎片`t` 原词 **the** ← 第二解: their(function)
### ctw_1781813469055_146472 — environmental_science/wetland restoration
- 空 5 碎片`th` 原词 **these** ← 第二解: the(function)
### ctw_1782158798669_812489 — history/ancient astronomy
- 空 9 碎片`ye` 原词 **year** ← 第二解: years(inflection)
### ctw_1782158798671_769268 — astronomy/planetary atmospheres
- 空 3 碎片`var` 原词 **varies** ← 第二解: vary(inflection)
- 空 5 碎片`th` 原词 **thick** ← 第二解: the(function)
### ctw_1782331802554_361833 — physics/lightning and thunder
- 空 3 碎片`a` 原词 **air** ← 第二解: and(function)
### ctw_1782590704878_611271 — biology/deep-sea hydrothermal vent communities
- 空 1 碎片`th` 原词 **these** ← 第二解: the(function)
- 空 2 碎片`li` 原词 **live** ← 第二解: like(content)
- 空 9 碎片`Tu` 原词 **Tube** ← 第二解: Tubeworms(content)
### ctw_1782590704880_515919 — psychology/early language development in children
- 空 2 碎片`scho` 原词 **schooling** ← 第二解: school(inflection)
### ctw_1782590704880_633770 — history/the building of ancient Egyptian pyramids
- 空 2 碎片`c` 原词 **cut** ← 第二解: came(content)
- 空 9 碎片`l` 原词 **let** ← 第二解: led(content)
- 空 10 碎片`buil` 原词 **builders** ← 第二解: building(content)
### ctw_1782763543353_957015 — biology/ribosomes and protein synthesis
- 空 5 碎片`str` 原词 **strand** ← 第二解: string(content)
### ctw_1782763543356_465582 — geology/ice ages and glaciation
- 空 2 碎片`sl` 原词 **slow** ← 第二解: slight(content)
### ctw_1783466785248_559673 — geology/rock formation
- 空 3 碎片`co` 原词 **cools** ← 第二解: cool(inflection)
- 空 4 碎片`har` 原词 **hardens** ← 第二解: harden(inflection)
- 空 7 碎片`be` 原词 **below** ← 第二解: beneath(content)
### ctw_1783466785248_560516 — astronomy/exoplanets
- 空 3 碎片`fa` 原词 **faint** ← 第二解: far(function)
- 空 8 碎片`brig` 原词 **brighter** ← 第二解: bright(content)
- 空 9 碎片`st` 原词 **stars** ← 第二解: star(inflection)
### ctw_1783545173662_655182 — biology/photosynthesis
- 空 8 碎片`Th` 原词 **This** ← 第二解: The(function)
### ctw_1783545173664_483335 — environmental_science/urban heat islands
- 空 7 碎片`th` 原词 **that** ← 第二解: the(function)
### ctw_1783545173665_989726 — geology/fossils
- 空 1 碎片`fo` 原词 **form** ← 第二解: fossils(content)

**状态：复核完成。**
