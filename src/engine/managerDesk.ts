import { Rng, clamp, dayStream, hashStr } from './rng'
import { mountDesk } from './desk'
import type { ClubMods, ContractsRun, ManagerDesk, StayApproach } from './desk'
import { ORIGINS, skillMod } from './manager'
import { analystEdge, resolveApproaches, resolveStaffOffers, staffBonus } from './staff'
import { acceptJob, defaultContract, offerJobs, resolveApplications } from './career'
import { offerGigs, resolveSponsorTalks, runGigsToday, settleSponsorDemands, streamWeek } from './commercial'
import { offerBundle, settleLeagueSeason, tickLeagueOffer } from './leagueShare'
import { prizeLedger, weeklyLedger } from './finance'
import { doPhysio, drillTick, physioBlock, reviewIglXp } from './drill'
import { aiTransferTick, bidForOurPlayers, refreshListings, resolveDueOffers, resolveEnquiries, windowOpen } from './transfer'
import { trustAfterMatch, weeklyTrust } from './trust'
import { dailyLife, weeklyLife } from './life'
import {
  continuePastFive, damped, noticeHint, seasonEnding, setObjective, settleAtFive, settleObjective, TITLE_REP_WORTH,
} from './board'
import { autoStarters } from './world'
import type { Competition, Fixture, GameState, MatchResult, Player, StageKey, Team } from './types'

/**
 * The manager game's desk: everything a person running a club does on top of
 * the world, wired to the moments the world calls it (engine/desk.ts).
 *
 * Each system keeps its own module — the ledger (finance.ts), sponsors and
 * commercial days (commercial.ts), the league's bundle (leagueShare.ts), staff
 * (staff.ts), job offers (career.ts), the board (board.ts), the drill and the
 * physio (drill.ts), bids and enquiries (transfer.ts), trust (trust.ts), the
 * squad's life (life.ts). This file is only the order they run in, which is the
 * order they ran in inside the world's day, on the same random streams.
 *
 * Mounted by src/ManagerGame.tsx. A player's career never loads it.
 */

/** A step's own stream for the day — the same tags the world's day used for them (engine/rng.ts dayStream). */
const side = (state: GameState, tag: string) => dayStream(state.seed, state.year, state.day, tag)

/**
 * One conversation, eye to eye, about how his story ends.
 *
 * Five ways to have it: appeal to the heart (free, long odds), put money on
 * the table (a 30% raise, the best odds), offer him the bench and the rookies
 * (middle ground), agree to find him a last dance somewhere else (certain —
 * he plays on, just not here), or accept it and give him the send-off he has
 * earned. Whatever is chosen, it is chosen once: asking twice is not
 * persuasion, it is pressure.
 */
function persuadeStay(state: GameState, playerId: string, approach: StayApproach = 'heart'): string {
  const p = state.players[playerId]
  if (!p) return '找不到这名选手。'
  if (p.teamId !== state.myTeam) return '他不是你队里的人，这话轮不到你说。'
  if (!p.retiring) return `${p.ign} 没打算退役。`
  if (p.persuaded) return '你已经和他谈过了——他的决定应该被尊重。'
  p.persuaded = true

  const locker = state.manager?.skills.locker ?? 50
  const nego = state.manager?.skills.negotiation ?? 50
  const roll = ((hashStr(`stay:${state.seed}:${state.year}:${p.id}:${approach}`) >>> 6) % 1000) / 1000
  const stays = (line: string) => {
    p.retiring = false
    state.news.push({ day: state.day, kind: 'player', important: true, text: `🤝 ${line}` })
    return line
  }

  switch (approach) {
    case 'raise': {
      const odds = clamp(0.5 + (nego - 50) * 0.006 + (p.morale - 60) * 0.003, 0.2, 0.9)
      if (roll < odds) {
        p.salary = Math.round(p.salary * 1.3)
        if (p.contract) p.contract.salary = p.salary
        p.contractYears = Math.max(1, p.contractYears)
        p.morale = clamp(p.morale + 8, 0, 100)
        return stays(`${p.ign} 收下了那份加薪合同——再战一年，年薪 $${p.salary.toLocaleString()}。`)
      }
      return `${p.ign} 把合同推了回来："不是钱的事。" 他心意已决，赛季打完就走。`
    }
    case 'bench': {
      const odds = clamp(0.42 + (locker - 50) * 0.007, 0.15, 0.8)
      if (roll < odds) {
        const t = state.teams[state.myTeam]
        if (t) {
          t.starters = t.starters.filter((id) => id !== p.id)
          if (t.starters.length < 5) t.starters = autoStarters(state, state.myTeam)
        }
        p.morale = clamp(p.morale + 3, 0, 100)
        return stays(`${p.ign} 同意退居替补，把经验留给年轻人——他还在基地里，这就够了。`)
      }
      return `${p.ign} 苦笑了一下："让我坐着看别人打？那还不如回家。" 他决定退役。`
    }
    case 'transfer': {
      p.listed = true
      p.listedOn = state.day
      p.morale = clamp(p.morale + 4, 0, 100)
      return stays(`${p.ign} 没想到你会成全他——他想换个环境打最后一舞，已挂牌，转会费能收回一点是一点。`)
    }
    case 'accept': {
      p.morale = clamp(p.morale + 6, 0, 100)
      state.news.push({
        day: state.day, kind: 'player', important: true,
        text: `🫡 俱乐部官宣：将在赛季末为 ${p.ign} 举办退役仪式。`,
      })
      return `你握了握他的手。俱乐部会在赛季末为 ${p.ign} 办一场配得上他生涯的退役仪式。`
    }
    default: {
      const odds = clamp(0.3 + (locker - 50) * 0.008 + (p.morale - 60) * 0.004, 0.1, 0.8)
      if (roll < odds) {
        p.morale = clamp(p.morale + 6, 0, 100)
        return stays(`${p.ign} 被你说动了——退役计划搁置，再战一年。`)
      }
      return `${p.ign} 听完摇了摇头——他心意已决，这个赛季打完就走。让他体面地离开吧。`
    }
  }
}

export const managerDesk: ManagerDesk = {
  initManager(state: GameState, managerName: string, manager?: GameState['manager']): void {
    const club = state.teams[state.myTeam]
    // extra cash some backgrounds bring with them
    const funds = manager ? ORIGINS.find((x) => x.key === manager.originKey)?.startingFunds ?? 0 : 0
    state.managerName = manager?.name ?? managerName
    state.manager = manager
    state.offers = []
    state.finances = { balance: (club?.budget ?? 0) + funds, log: [] }
    state.honours = []
    state.boardConfidence = 62
    for (const pid of club?.roster ?? []) state.training[pid] = 'rest'
    // the squad you inherited, kept so an ending can ask who is still here in
    // ten years' time — the record, not a flag set when somebody leaves
    state.startingSquad = [...(club?.roster ?? [])]
    state.startFacilities = club?.facilities
    state.startTier = club?.tier
    // they are yours from today, so today is where their development is measured from
    for (const id of state.startingSquad) {
      const p = state.players[id]
      if (p) p.arrivedOverall = p.overall
    }
  },

  seasonSetup(state: GameState, notes?: string[]): void {
    state.managerContract ??= defaultContract(state)
    // give the market a starting state, so the first window is not empty
    refreshListings(state, new Rng(hashStr(`market:${state.seed}:${state.year}`)), notes)
  },

  holdsClock(state: GameState): boolean {
    return !!state.midReview
  },

  dayOpened(state: GameState, notes: string[]): void {
    dailyLife(state, notes)
  },

  stageChanged(state: GameState, prevStage: StageKey, notes: string[]): void {
    settleObjective(state, prevStage, notes)
    setObjective(state, notes)
    offerJobs(state, notes)
    // some years the league floats a themed capsule as Stage 1 opens —
    // deterministic per save+year, so a reload does not conjure a new one
    if (state.stage === 'stage1'
      && ((hashStr(`bundle:${state.seed}:${state.year}`) >>> 4) % 100) < 60) {
      offerBundle(state, notes)
    }
  },

  dayStarted(state: GameState, notes: string[]): void {
    tickLeagueOffer(state, notes)
  },

  matchPlayed(state: GameState, f: Fixture, result: MatchResult): void {
    const isA = f.teamA === state.myTeam
    const won = (result.mapsWonA > result.mapsWonB) === isA
    const drawn = result.mapsWonA === result.mapsWonB
    // a level Bo2 is neither a win to trust nor a defeat to fall out over
    if (!drawn) trustAfterMatch(state, won, (isA ? result.lineups?.a : result.lineups?.b) ?? [])
    // scrims build trust, not the board's opinion
    if (f.comp === 'scrim') return
    state.boardConfidence = clamp(state.boardConfidence + (drawn ? 0 : won ? 1.2 : -1.4), 0, 100)
  },

  competitionSettled(state: GameState, comp: Competition, notes: string[]): void {
    // the prize money in the club's own books, its players' cut taken off
    prizeLedger(state, comp)
    if (comp.champion === state.myTeam) {
      state.honours.push({ year: state.year, title: comp.name })
      state.boardConfidence = clamp(state.boardConfidence + 14, 0, 100)
      // winning is what actually makes your name
      if (state.manager) {
        const worth = comp.region ? TITLE_REP_WORTH.regional : TITLE_REP_WORTH.international
        state.manager.reputation = clamp(state.manager.reputation + damped(state.manager.reputation, worth), 5, 96)
      }
    }
    // Sponsorship performance bonuses. A regional stage we finish at or above
    // the threshold pays that contract, once per season, so a good split is
    // worth money and a sponsor is worth choosing for its terms. Regional only,
    // or an international run would pay every contract twice.
    if (comp.region && comp.finished.includes(state.myTeam)) {
      const me = state.teams[state.myTeam]
      const place = comp.finished.indexOf(state.myTeam) + 1
      // the best regional finish of the season is what a `placing` clause reads
      state.bestPlacing = Math.min(state.bestPlacing ?? 99, place)
      for (const sp of me?.sponsors ?? []) {
        if (sp.bonusPaidYear === state.year || place > sp.bonusPlacement || !sp.bonus) continue
        sp.bonusPaidYear = state.year
        state.finances.balance += sp.bonus
        state.finances.log.push({
          day: state.day, label: `赞助达标奖 · ${sp.name}（${comp.name} 第 ${place} 名）`, amount: sp.bonus,
        })
        notes.push(`💰 ${sp.name} 的达标奖金 $${sp.bonus.toLocaleString()} 到账——${comp.name} 第 ${place} 名，合同要求前 ${sp.bonusPlacement}。`)
      }
    }
    // the board reacts to how we finished — a bottom-third finish at Masters costs 7 confidence
    if (comp.champion !== state.myTeam && comp.teams.includes(state.myTeam)) {
      const place = comp.finished.indexOf(state.myTeam)
      if (place >= 0) {
        const share = place / Math.max(1, comp.finished.length - 1)
        const swing = share < 0.34 ? 5 : share > 0.7 ? -7 : 0
        state.boardConfidence = clamp(state.boardConfidence + swing, 0, 100)
        const rank = `${comp.name} 第 ${place + 1} 名（共 ${comp.finished.length} 队）`
        notes.push(
          swing > 0 ? `🏅 ${rank}，董事会满意（信任 +${swing}）。`
            : swing < 0 ? `📉 ${rank}，董事会不满（信任 ${swing}）。`
              : `🏁 ${rank}。`,
        )
      }
    }
  },

  afterMatches(state: GameState, notes: string[]): void {
    // ---- commercial work booked for today, then any new approach
    runGigsToday(state, notes)
    offerGigs(state, side(state, 'gigs'), notes)
    notes.push(...resolveSponsorTalks(state, side(state, 'sponsors')))
    drillTick(state, side(state, 'drill'), notes)
    // ---- coaches and clubs answering today
    notes.push(...resolveApproaches(state, side(state, 'approaches')))
    notes.push(...resolveStaffOffers(state, side(state, 'staff')))
    notes.push(...resolveApplications(state, side(state, 'jobs')))
    // ---- offers whose waiting period is up
    notes.push(...resolveEnquiries(state, side(state, 'enquiries')))
    notes.push(...resolveDueOffers(state, side(state, 'offers')))
  },

  weekOpened(state: GameState, notes: string[]): void {
    streamWeek(state, side(state, 'stream'), notes)
    weeklyTrust(state, side(state, 'trust'), notes)
    const missed = Object.entries(state.commercialDays ?? {})
      .filter(([, d]) => d >= 2)
      .map(([id]) => state.players[id]?.ign)
      .filter(Boolean)
    if (missed.length) {
      notes.push(`📉 本周 ${missed.join('、')} 商务占用较多，训练收益明显下降。`)
    }
  },

  weekTrained(state: GameState, grumbling: Player[], notes: string[]): void {
    // a promised standing is a commitment: bench a man you called a core and he says so
    const grumble = side(state, 'grievance')
    for (const p of grumbling) {
      if (!grumble.chance(0.25) || p.listed) continue
      notes.push(`😠 ${p.ign} 对出场时间不满，已经在考虑离队（承诺是${p.contract?.promisedRole === 'star' ? '核心' : '首发'}）。`)
    }
    // the week has been settled, so commercial time starts over
    state.commercialDays = {}
    weeklyLife(state, side(state, 'life'), notes)
    weeklyLedger(state)
  },

  weekMarket(state: GameState, notes: string[]): void {
    // the AI clubs work the market, bid for his players, and list or withdraw their own
    aiTransferTick(state, side(state, 'market'), notes)
    if (windowOpen(state.day)) bidForOurPlayers(state, side(state, 'bids'), notes)
    refreshListings(state, side(state, 'listings'), notes)   // runs all year so stale listings expire
  },

  seasonEnding(state: GameState, notes: string[]): boolean {
    return seasonEnding(state, notes)
  },

  ascension(state: GameState, promoted: Team, relegated: Team, notes: string[]): void {
    // Going up is a windfall and coming down is a cliff, and both are things a
    // manager should be told rather than discover.
    if (promoted.id === state.myTeam) {
      notes.push('💰 升入一级联赛后，赞助合同全部重新议价，收入大幅提高。')
      state.honours.push({ year: state.year, title: `晋级 VCT ${promoted.region}` })
    }
    if (relegated.id === state.myTeam) {
      notes.push('📉 降级后赞助合同被重新议价，赛季收入大幅缩水——先把薪资压下来。')
    }
  },

  contractsRun(state: GameState, run: ContractsRun, notes: string[]): void {
    for (const p of run.walked) {
      state.news.push({
        day: state.day, kind: 'club', important: true,
        text: `👋 ${p.ign} 的合同到期满一年未续约，已经离队。`,
      })
      notes.push(`👋 ${p.ign} 合同到期一年未续，已自由转会离队。`)
    }
    for (const p of run.expiring) {
      state.news.push({
        day: state.day, kind: 'club', important: true,
        text: `⏳ ${p.ign} 的合同已到期，本赛季内必须续约，否则下个休赛期他会走。`,
      })
      notes.push(`⏳ ${p.ign} 的合同已到期——这是最后一个赛季，不续约他就走了。`)
    }
    // a deal running down is the thing a manager most needs warning about
    if (run.finalYear.length) {
      notes.push(`📋 合同进入最后一年：${run.finalYear.slice(0, 6).join('、')}`
        + (run.finalYear.length > 6 ? ` 等 ${run.finalYear.length} 人` : ''))
    }
  },

  retiring(_state: GameState, p: Player, notes: string[]): void {
    notes.push(`📢 ${p.ign} 告诉你，这将是他的最后一个赛季——想留他，去他的资料页当面谈。`)
  },

  seasonClosing(state: GameState, notes: string[]): void {
    // clauses are judged on the season that just ended, before the counters reset
    notes.push(...settleSponsorDemands(state))
    // and so is the league's bundle money — champ points reset with the rollover
    settleLeagueSeason(state, notes)
    state.seasonGigs = 0
    state.bestPlacing = undefined
    // a new season, a new chance to hit the placement each contract asks for
    for (const t of Object.values(state.teams)) {
      for (const sp of t.sponsors) delete sp.bonusPaidYear
    }
  },

  clockRebased(state: GameState, shift: number): void {
    if (state.pitchCooldown != null) state.pitchCooldown = Math.max(0, state.pitchCooldown - shift)
    if (state.drillLock != null) state.drillLock = Math.max(0, state.drillLock - shift)
    // physio bookings live in the past; left unshifted, "day - last" went
    // negative after the new year and locked the whole squad out of the physio
    // room for a season ("理疗室不能点了")
    if (state.physioOn) {
      for (const k of Object.keys(state.physioOn)) state.physioOn[k] -= shift
    }
    // the turn budget re-mints itself whenever its day is in the future or past
    state.actions = undefined
    for (const p of Object.values(state.players)) {
      if (p.listedOn != null) p.listedOn -= shift
      if (p.payAskedOn != null) p.payAskedOn -= shift
      if (p.rumourOn != null) p.rumourOn -= shift
      if (p.stream) {
        p.stream.since -= shift
        p.stream.until -= shift
      }
    }
    for (const o of state.offers ?? []) {
      o.day -= shift
      if (o.respondOn != null) o.respondOn -= shift
    }
    for (const e of state.enquiries ?? []) { e.day -= shift; e.replyOn -= shift }
    for (const j of state.jobOffers ?? []) { j.day -= shift; j.expiresOn -= shift }
    for (const a of state.jobApplications ?? []) { a.day -= shift; a.replyOn -= shift }
    for (const o of state.staffOffers ?? []) { o.day -= shift; o.replyOn -= shift }
    for (const a of state.staffApproaches ?? []) { a.day -= shift; a.replyOn -= shift }
    for (const t of state.sponsorTalks ?? []) { t.day -= shift; t.replyOn -= shift }
    for (const g of state.gigs ?? []) {
      g.day -= shift
      g.expiresOn -= shift
      if (g.windowEnd != null) g.windowEnd -= shift
    }
    for (const v of state.ventures ?? []) v.day -= shift
  },

  clubMods(state: GameState): ClubMods {
    const m = state.manager
    return {
      // 体能: rest gives back more
      rest: skillMod(m, 'medical', 0.008),
      // the staff behind the head coach count too
      devHelp: staffBonus(state, 'development'),
      // 训练 lifts everything; 带新人 only pays on players young enough to grow
      talent: (p: Player) => skillMod(m, 'training') * (p.age <= 22 ? skillMod(m, 'youth', 0.006) : 1),
      // days spent on commercial work are days not spent practising
      booked: (p: Player) => state.commercialDays?.[p.id] ?? 0,
      // 体能: fewer injuries under a manager who manages load
      injury: 2 - skillMod(m, 'medical', 0.008),
      care: skillMod(m, 'medical', 0.008),
      // 更衣室: grievance builds slower when the manager handles people well
      soothe: 2 - skillMod(m, 'locker', 0.006),
      // 更衣室 is the manager's own lever on the room, alongside the coach's
      bondsHeal: skillMod(m, 'locker', 0.012),
      // 战术: the manager's own read of the game; 对手研究: knowing what they run is worth about half a head coach
      coach: (skillMod(m, 'tactics', 0.06) - 1) + analystEdge(state, 'opponent') * 2.4,
      // 经济分析: better buys and better utility timing, all game
      utility: analystEdge(state, 'economy') * 1.8,
    }
  },

  acceptJob: (state: GameState, offerId: string) => acceptJob(state, offerId),
  persuadeStay: (state: GameState, playerId: string, approach: StayApproach) => persuadeStay(state, playerId, approach),
  settleAtFive: (state: GameState) => settleAtFive(state),
  continuePastFive: (state: GameState) => continuePastFive(state),
  noticeHint: (state: GameState) => noticeHint(state),
  reviewIglXp: (state: GameState, p: Player) => reviewIglXp(state, p),
  physioBlock: (state: GameState, playerId: string) => physioBlock(state, playerId),
  doPhysio: (state: GameState, playerId: string) => doPhysio(state, playerId),
}

/** The manager game's screen calls this once, when it loads. */
export function mountManagerDesk(): void {
  mountDesk(managerDesk)
}
