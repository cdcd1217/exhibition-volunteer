import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

// ══════════════════════════════════════════════════════════════════════
const ADMIN_PASSWORD = "admin1234";
const DEFAULT_LOCATION_NAMES = ["A 전시대", "B 전시대", "C 전시대", "D 전시대", "E 전시대"];
const CANCEL_REASONS = ["날씨 불량", "인원 부족", "인도자 없음", "장소 사정", "기타"];

const KR_HOLIDAYS = {
  "2024-01-01":"신정","2024-02-09":"설날 연휴","2024-02-10":"설날","2024-02-11":"설날 연휴","2024-02-12":"대체공휴일",
  "2024-03-01":"삼일절","2024-04-10":"국회의원선거일","2024-05-05":"어린이날","2024-05-06":"대체공휴일",
  "2024-05-15":"부처님오신날","2024-06-06":"현충일","2024-08-15":"광복절","2024-09-16":"추석 연휴",
  "2024-09-17":"추석","2024-09-18":"추석 연휴","2024-10-03":"개천절","2024-10-09":"한글날","2024-12-25":"성탄절",
  "2025-01-01":"신정","2025-01-28":"설날 연휴","2025-01-29":"설날","2025-01-30":"설날 연휴",
  "2025-03-01":"삼일절","2025-03-03":"대체공휴일","2025-05-05":"어린이날","2025-05-06":"부처님오신날",
  "2025-06-03":"대통령선거일","2025-06-06":"현충일","2025-08-15":"광복절","2025-10-03":"개천절",
  "2025-10-05":"추석 연휴","2025-10-06":"추석","2025-10-07":"추석 연휴","2025-10-08":"대체공휴일",
  "2025-10-09":"한글날","2025-12-25":"성탄절",
  "2026-01-01":"신정","2026-02-16":"설날 연휴","2026-02-17":"설날","2026-02-18":"설날 연휴",
  "2026-03-01":"삼일절","2026-05-05":"어린이날","2026-05-24":"부처님오신날","2026-05-25":"대체공휴일",
  "2026-06-06":"현충일","2026-08-15":"광복절","2026-09-24":"추석 연휴","2026-09-25":"추석",
  "2026-09-26":"추석 연휴","2026-10-03":"개천절","2026-10-09":"한글날","2026-12-25":"성탄절",
};

// ── 헬퍼 함수들 ──────────────────────────────────────────────────────
function buildSchedule(participants, startTimeStr, totalHours) {
  const n = participants.length;
  if (n < 2) return [];
  const pph = Math.ceil(n / 2);
  const slotMin = Math.floor(60 / pph);
  const base = [];
  for (let i = 0; i < n; i += 2)
    base.push(i+1 < n ? [participants[i], participants[i+1]] : [participants[i], participants[0]]);
  const all = [];
  for (let c = 0; c < totalHours; c++) base.forEach(p => all.push([...p]));
  let [h, m] = startTimeStr.split(":").map(Number);
  return all.map((pair, idx) => {
    const s = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    const et = h*60+m+slotMin, eh=Math.floor(et/60), em=et%60;
    const e = `${String(eh).padStart(2,"0")}:${String(em).padStart(2,"0")}`;
    h=eh; m=em;
    return { pair, start:s, end:e, slotIndex:idx+1, cycle:Math.floor(idx/base.length)+1 };
  });
}

function getDeadlineInfo(dk, startTime) {
  if (!dk||!startTime) return null;
  const [y,mo,d]=dk.split("-").map(Number);
  const [h,mi]=startTime.split(":").map(Number);
  const svc = new Date(y,mo-1,d,h,mi,0);
  const deadline = new Date(svc.getTime()-12*3600*1000);
  const diffMs = deadline - new Date();
  if (diffMs<=0) return {expired:true};
  const ts=Math.floor(diffMs/1000);
  return {expired:false,days:Math.floor(ts/86400),hours:Math.floor((ts%86400)/3600),mins:Math.floor((ts%3600)/60),secs:ts%60,diffMs};
}

function fmt(dk) {
  if (!dk) return "";
  const [y,mo,d]=dk.split("-");
  return `${y}년 ${parseInt(mo)}월 ${parseInt(d)}일`;
}
function dkOf(y,mo,d) { return `${y}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

function buildCancelSms(dk, reason, registrations) {
  const names=[...new Set(Object.values(registrations||{}).flat())];
  return `[전시대 봉사 취소 안내]\n\n📅 ${fmt(dk)} 전시대 봉사가 취소되었습니다.\n\n❌ 취소 사유: ${reason}\n\n참여 신청해 주신 분들께 감사드리며,\n다음 기회에 함께하도록 하겠습니다.\n\n신청자: ${names.join(", ")}`;
}
function buildScheduleSms(dk, locName, slots, startTime, totalHours) {
  let txt = `[전시대 봉사 시간표]\n📅 ${fmt(dk)}\n📍 ${locName}\n⏰ ${startTime} 시작 (${totalHours}시간)\n\n`;
  slots.forEach(s=>{ txt+=`${s.slotIndex}. ${s.start}~${s.end}  ${s.pair.join(", ")}\n`; });
  return txt + `\n봉사에 참여해 주셔서 감사합니다.`;
}
function buildLeaderNoticeSms(dk, locName, regs, startTime, totalHours, leaderName) {
  let txt = `[전시대 봉사 안내]\n\n안녕하세요, ${leaderName} 인도자입니다.\n\n`;
  txt += `📅 ${fmt(dk)}\n📍 ${locName}\n⏰ ${startTime} 시작 (${totalHours}시간)\n\n함께 봉사할 분들:\n`;
  regs.forEach((name, i) => { txt += `  ${i+1}. ${name}\n`; });
  return txt + `\n시간에 맞춰 함께해 주세요. 감사합니다!`;
}

const today=new Date();
const todayKey=dkOf(today.getFullYear(),today.getMonth(),today.getDate());

// ── UI 컴포넌트 ───────────────────────────────────────────────────────
const GenderBadge = ({gender}) => (
  <span style={{fontSize:10,fontWeight:800,borderRadius:8,padding:"1px 6px",background:gender==="형제"?"rgba(59,130,246,0.2)":"rgba(236,72,153,0.2)",color:gender==="형제"?"#60a5fa":"#f472b6",border:`1px solid ${gender==="형제"?"rgba(59,130,246,0.4)":"rgba(236,72,153,0.4)"}`}}>{gender}</span>
);
const LeaderBadge = () => (
  <span style={{fontSize:10,fontWeight:800,borderRadius:8,padding:"1px 6px",background:"rgba(251,191,36,0.2)",color:"#fbbf24",border:"1px solid rgba(251,191,36,0.4)"}}>인도자</span>
);
const Spinner = () => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"60px 0"}}>
    <div style={{width:40,height:40,border:"3px solid rgba(99,102,241,0.2)",borderTop:"3px solid #6366f1",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

// ══════════════════════════════════════════════════════════════════════
export default function App() {
  // ── 로딩 & 인증 ──────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("login");
  const [currentUser, setCurrentUser] = useState(null);
  const [loginInput, setLoginInput] = useState("");
  const [adminPwInput, setAdminPwInput] = useState("");
  const [loginMode, setLoginMode] = useState("member");
  const [loginError, setLoginError] = useState("");

  // ── DB 데이터 ────────────────────────────────────────────────────
  const [members, setMembers] = useState([]);
  const [serviceDates, setServiceDates] = useState({}); // dk → dateRow
  const [registrations, setRegistrations] = useState({}); // dk → {locIdx:[names]}
  const [locationNames, setLocationNames] = useState([...DEFAULT_LOCATION_NAMES]);

  // ── UI 상태 ──────────────────────────────────────────────────────
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [appTab, setAppTab] = useState("calendar");
  const [now, setNow] = useState(new Date());

  const [editingLocIdx, setEditingLocIdx] = useState(null);
  const [editingLocName, setEditingLocName] = useState("");
  const [nm, setNm] = useState(""); const [nph, setNph] = useState("");
  const [ngen, setNgen] = useState("형제"); const [nadm, setNadm] = useState(false);
  const [nldr, setNldr] = useState(false);
  const [editPhoneIdx, setEditPhoneIdx] = useState(null);
  const [editPhoneVal, setEditPhoneVal] = useState("");
  const [smsModal, setSmsModal] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [cancelCustom, setCancelCustom] = useState("");
  const [saving, setSaving] = useState(false);

  const DAY=["일","월","화","수","목","금","토"];
  const MON=["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
  const daysInMonth=useMemo(()=>new Date(year,month+1,0).getDate(),[year,month]);
  const firstDow=useMemo(()=>new Date(year,month,1).getDay(),[year,month]);
  const isAdmin=currentUser?.isAdmin;
  const selData = selectedDate ? serviceDates[selectedDate] : null;
  const selRegs = selectedDate ? (registrations[selectedDate] || {}) : {};

  // 1초 타이머
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);

  // ══════════════════════════════════════════════════════════════════
  //  DB 로드
  // ══════════════════════════════════════════════════════════════════
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, sdRes, regRes, setRes] = await Promise.all([
        supabase.from("members").select("*").order("created_at"),
        supabase.from("service_dates").select("*"),
        supabase.from("registrations").select("*"),
        supabase.from("settings").select("*"),
      ]);

      if (mRes.data) setMembers(mRes.data.map(m=>({
        name:m.name, phone:m.phone||"", gender:m.gender||"형제",
        isAdmin:m.is_admin, isLeader:m.is_leader, id:m.id
      })));

      if (sdRes.data) {
        const sd = {};
        sdRes.data.forEach(row => {
          sd[row.date_key] = {
            active: row.active,
            activeLocations: row.active_locations || [true,false,false,false,false],
            startTime: row.start_time,
            totalHours: row.total_hours,
            cancelled: row.cancelled,
            cancelReason: row.cancel_reason,
            leaders: row.leaders || {},
            scheduleOverrides: row.schedule_overrides || {},
          };
        });
        setServiceDates(sd);
      }

      if (regRes.data) {
        const regs = {};
        regRes.data.forEach(row => {
          if (!regs[row.date_key]) regs[row.date_key] = {};
          if (!regs[row.date_key][row.loc_idx]) regs[row.date_key][row.loc_idx] = [];
          regs[row.date_key][row.loc_idx].push(row.member_name);
        });
        setRegistrations(regs);
      }

      if (setRes.data) {
        const locSetting = setRes.data.find(s=>s.key==="location_names");
        if (locSetting?.value) setLocationNames(locSetting.value);
      }
    } catch(e) { console.error("loadAll error:", e); }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ══════════════════════════════════════════════════════════════════
  //  실시간 구독 (다른 사용자 변경 즉시 반영)
  // ══════════════════════════════════════════════════════════════════
  useEffect(() => {
    const sub = supabase.channel("realtime-all")
      .on("postgres_changes", {event:"*", schema:"public", table:"registrations"}, loadAll)
      .on("postgres_changes", {event:"*", schema:"public", table:"service_dates"}, loadAll)
      .on("postgres_changes", {event:"*", schema:"public", table:"members"}, loadAll)
      .on("postgres_changes", {event:"*", schema:"public", table:"settings"}, loadAll)
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [loadAll]);

  // ══════════════════════════════════════════════════════════════════
  //  로그인
  // ══════════════════════════════════════════════════════════════════
  const handleLogin = async () => {
    setLoginError("");
    if (loginMode==="admin") {
      if (adminPwInput!==ADMIN_PASSWORD) { setLoginError("비밀번호가 틀렸습니다."); return; }
      setCurrentUser({name:"관리자",isAdmin:true,gender:"형제",isLeader:true});
      setScreen("app");
    } else {
      const name=loginInput.trim();
      if (!name) { setLoginError("이름을 입력하세요."); return; }
      const found=members.find(m=>m.name===name);
      if (!found) { setLoginError("등록된 이름이 아닙니다.\n관리자에게 문의하세요."); return; }
      setCurrentUser(found); setScreen("app");
    }
  };
  const logout=()=>{setCurrentUser(null);setScreen("login");setLoginInput("");setAdminPwInput("");setLoginError("");setLoginMode("member");setSelectedDate(null);setAppTab("calendar");};

  // ══════════════════════════════════════════════════════════════════
  //  날짜 관리
  // ══════════════════════════════════════════════════════════════════
  const toggleDateActive = async (dk) => {
    const ex = serviceDates[dk];
    if (ex?.active) {
      await supabase.from("service_dates").update({active:false}).eq("date_key",dk);
    } else if (ex) {
      await supabase.from("service_dates").update({active:true}).eq("date_key",dk);
    } else {
      await supabase.from("service_dates").insert({
        date_key:dk, active:true,
        active_locations:[true,false,false,false,false],
        start_time:"09:00", total_hours:2,
        cancelled:false, cancel_reason:"", leaders:{}, schedule_overrides:{}
      });
    }
    await loadAll();
  };

  const updateDateField = async (dk, field, val) => {
    const colMap = {startTime:"start_time",totalHours:"total_hours",activeLocations:"active_locations",leaders:"leaders",scheduleOverrides:"schedule_overrides",cancelled:"cancelled",cancelReason:"cancel_reason"};
    await supabase.from("service_dates").update({[colMap[field]||field]:val}).eq("date_key",dk);
    await loadAll();
  };

  const toggleLocation = async (dk, locIdx) => {
    const locs=[...(serviceDates[dk]?.activeLocations||[true,false,false,false,false])];
    locs[locIdx]=!locs[locIdx];
    await updateDateField(dk,"activeLocations",locs);
  };

  const deleteDateFully = async (dk) => {
    await supabase.from("registrations").delete().eq("date_key",dk);
    await supabase.from("service_dates").delete().eq("date_key",dk);
    if (selectedDate===dk) { setSelectedDate(null); setAppTab("calendar"); }
    await loadAll();
  };

  const getActiveLocIndices = (dk) => {
    const locs=serviceDates[dk]?.activeLocations||[true,false,false,false,false];
    return locs.map((on,i)=>on?i:null).filter(i=>i!==null);
  };

  // ══════════════════════════════════════════════════════════════════
  //  취소
  // ══════════════════════════════════════════════════════════════════
  const confirmCancel = async () => {
    const reason=cancelReason==="기타"?(cancelCustom.trim()||"기타"):cancelReason;
    await supabase.from("service_dates").update({cancelled:true,cancel_reason:reason}).eq("date_key",cancelModal.dk);
    await loadAll();
    const text=buildCancelSms(cancelModal.dk,reason,registrations[cancelModal.dk]||{});
    setCancelModal(null);
    setSmsModal({type:"cancel",dk:cancelModal.dk,text});
  };
  const undoCancel = async (dk) => {
    await supabase.from("service_dates").update({cancelled:false,cancel_reason:""}).eq("date_key",dk);
    await loadAll();
  };

  const isDeadlinePassed=(dk)=>{
    const d=serviceDates[dk]; if(!d)return false;
    return getDeadlineInfo(dk,d.startTime)?.expired??false;
  };

  // ══════════════════════════════════════════════════════════════════
  //  신청 / 취소
  // ══════════════════════════════════════════════════════════════════
  const register = async (dk, locIdx) => {
    if (isDeadlinePassed(dk)) return;
    const name=currentUser.name;
    const regs=(registrations[dk]?.[locIdx]||[]);
    if (regs.includes(name)||regs.length>=8) return;
    await supabase.from("registrations").insert({date_key:dk,loc_idx:locIdx,member_name:name});
    await loadAll();
  };
  const unregister = async (dk, locIdx) => {
    if (isDeadlinePassed(dk)) return;
    await supabase.from("registrations").delete().eq("date_key",dk).eq("loc_idx",locIdx).eq("member_name",currentUser.name);
    await loadAll();
  };
  const adminRemove = async (dk, locIdx, name) => {
    await supabase.from("registrations").delete().eq("date_key",dk).eq("loc_idx",locIdx).eq("member_name",name);
    await loadAll();
  };

  // ══════════════════════════════════════════════════════════════════
  //  인도자
  // ══════════════════════════════════════════════════════════════════
  const setLeader = async (dk, locIdx, name) => {
    const cur=serviceDates[dk]?.leaders||{};
    const next={...cur,[locIdx]:cur[locIdx]===name?null:name};
    await updateDateField(dk,"leaders",next);
  };

  // ══════════════════════════════════════════════════════════════════
  //  시간표 override
  // ══════════════════════════════════════════════════════════════════
  const getSlots = (dk, locIdx) => {
    const d=serviceDates[dk]; if(!d)return[];
    const ov=d.scheduleOverrides?.[locIdx];
    if(ov?.length>0)return ov;
    return buildSchedule(registrations[dk]?.[locIdx]||[],d.startTime,d.totalHours??2);
  };
  const updateSlot = async (dk, locIdx, si, field, val) => {
    const d=serviceDates[dk];
    const auto=buildSchedule(registrations[dk]?.[locIdx]||[],d.startTime,d.totalHours??2);
    const cur=(d.scheduleOverrides?.[locIdx]?.length>0)?d.scheduleOverrides[locIdx]:auto;
    const updated=cur.map((s,i)=>i===si?{...s,[field]:val}:s);
    const newOv={...d.scheduleOverrides,[locIdx]:updated};
    await updateDateField(dk,"scheduleOverrides",newOv);
  };
  const resetSchedule = async (dk, locIdx) => {
    const ov={...serviceDates[dk]?.scheduleOverrides}; delete ov[locIdx];
    await updateDateField(dk,"scheduleOverrides",ov);
  };

  // ══════════════════════════════════════════════════════════════════
  //  회원 관리
  // ══════════════════════════════════════════════════════════════════
  const addMember = async () => {
    const name=nm.trim(); if(!name||members.find(m=>m.name===name))return;
    await supabase.from("members").insert({name,phone:nph.trim(),gender:ngen,is_admin:nadm,is_leader:nldr});
    await loadAll();
    setNm("");setNph("");setNgen("형제");setNadm(false);setNldr(false);
  };
  const removeMember = async (name) => {
    if(name==="관리자")return;
    await supabase.from("members").delete().eq("name",name);
    await loadAll();
  };
  const toggleMemberAdmin = async (name) => {
    if(name==="관리자")return;
    const m=members.find(x=>x.name===name); if(!m)return;
    await supabase.from("members").update({is_admin:!m.isAdmin}).eq("name",name);
    await loadAll();
  };
  const toggleMemberLeader = async (name) => {
    if(name==="관리자")return;
    const m=members.find(x=>x.name===name); if(!m)return;
    await supabase.from("members").update({is_leader:!m.isLeader}).eq("name",name);
    await loadAll();
  };
  const savePhone = async (name) => {
    await supabase.from("members").update({phone:editPhoneVal}).eq("name",name);
    await loadAll(); setEditPhoneIdx(null);
  };

  // ══════════════════════════════════════════════════════════════════
  //  전시대 이름
  // ══════════════════════════════════════════════════════════════════
  const startEditLoc=i=>{setEditingLocIdx(i);setEditingLocName(locationNames[i]);};
  const saveLocName = async () => {
    if(!editingLocName.trim())return;
    const next=[...locationNames]; next[editingLocIdx]=editingLocName.trim();
    await supabase.from("settings").upsert({key:"location_names",value:next});
    await loadAll(); setEditingLocIdx(null);
  };

  // ══════════════════════════════════════════════════════════════════
  //  SMS
  // ══════════════════════════════════════════════════════════════════
  const openScheduleSms=(dk,locIdx)=>{
    const d=serviceDates[dk]; const slots=getSlots(dk,locIdx);
    setSmsModal({type:"schedule",dk,locIdx,text:buildScheduleSms(dk,locationNames[locIdx],slots,d.startTime,d.totalHours??2)});
  };
  const sendSms=()=>{
    let nums=[];
    const dk=smsModal.dk; const locIdx=smsModal.locIdx;
    if(smsModal.type==="schedule") nums=(registrations[dk]?.[locIdx]||[]).map(n=>members.find(m=>m.name===n)?.phone).filter(Boolean);
    else if(smsModal.type==="leader") nums=(registrations[dk]?.[locIdx]||[]).filter(n=>n!==currentUser?.name).map(n=>members.find(m=>m.name===n)?.phone).filter(Boolean);
    else nums=[...new Set(Object.values(registrations[dk]||{}).flat())].map(n=>members.find(m=>m.name===n)?.phone).filter(Boolean);
    if(nums.length) window.location.href=`sms:${nums.join(",")}?body=${encodeURIComponent(smsModal.text)}`;
    else navigator.clipboard?.writeText(smsModal.text).then(()=>alert("클립보드에 복사되었습니다."));
  };

  const hasBrotherInLoc=(dk,locIdx)=>(registrations[dk]?.[locIdx]||[]).some(name=>members.find(m=>m.name===name)?.gender==="형제");

  // 카운트다운 렌더
  const renderCountdown=(info,urgent)=>(
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      {[{v:info.days,l:"일"},{v:info.hours,l:"시간"},{v:info.mins,l:"분"},{v:info.secs,l:"초"}]
        .filter(x=>x.v>0||x.l==="초"||x.l==="분").map(x=>(
          <div key={x.l} style={{textAlign:"center"}}>
            <div style={{background:urgent?"rgba(239,68,68,0.2)":"rgba(99,102,241,0.2)",border:`1px solid ${urgent?"rgba(239,68,68,0.4)":"rgba(99,102,241,0.4)"}`,borderRadius:10,padding:"5px 10px",minWidth:38,fontWeight:900,fontSize:16,color:urgent?"#fca5a5":"#c4b5fd",fontVariantNumeric:"tabular-nums"}}>
              {String(x.v).padStart(2,"0")}
            </div>
            <div style={{fontSize:10,color:"#64748b",marginTop:2}}>{x.l}</div>
          </div>
        ))}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════
  //  로딩 화면
  // ══════════════════════════════════════════════════════════════════
  if (loading) return (
    <div style={{...S.page,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
      <div style={S.logoBox}>📋</div>
      <h1 style={{...S.logoTitle,marginTop:16}}>전시대 봉사 신청</h1>
      <Spinner/>
      <p style={{color:"#64748b",fontSize:13,marginTop:8}}>데이터 불러오는 중...</p>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════
  //  로그인 화면
  // ══════════════════════════════════════════════════════════════════
  if (screen==="login") return (
    <div style={S.page}>
      <div style={S.loginWrap}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={S.logoBox}>📋</div>
          <h1 style={S.logoTitle}>전시대 봉사 신청</h1>
          <p style={S.logoSub}>Exhibition Booth Volunteer System</p>
        </div>
        <div style={S.modeRow}>
          {[{key:"member",icon:"👤",label:"참여자로 접속",sub:"이름으로 로그인"},{key:"admin",icon:"🔑",label:"관리자로 접속",sub:"비밀번호로 로그인"}].map(({key,icon,label,sub})=>(
            <button key={key} onClick={()=>{setLoginMode(key);setLoginError("");}} style={{...S.modeBtn,...(loginMode===key?S.modeBtnOn:{})}}>
              <span style={{fontSize:26,display:"block",marginBottom:6}}>{icon}</span>
              <span style={{fontWeight:800,fontSize:14,display:"block"}}>{label}</span>
              <span style={{fontSize:11,color:loginMode===key?"rgba(255,255,255,0.6)":"#4b5563",display:"block",marginTop:3}}>{sub}</span>
            </button>
          ))}
        </div>
        <div style={S.loginCard}>
          {loginMode==="member"
            ?<><label style={S.label}>이름 입력</label>
              <input style={S.input} placeholder="등록된 이름을 정확히 입력하세요" value={loginInput} onChange={e=>{setLoginInput(e.target.value);setLoginError("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/>
              <p style={S.hint}>💡 관리자가 등록한 이름만 접속할 수 있습니다</p></>
            :<><label style={S.label}>관리자 비밀번호</label>
              <input type="password" style={S.input} placeholder="비밀번호를 입력하세요" value={adminPwInput} onChange={e=>{setAdminPwInput(e.target.value);setLoginError("");}} onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/></>
          }
          {loginError&&<div style={S.errMsg}>{loginError}</div>}
          <button onClick={handleLogin} style={S.loginBtn}>접속하기 →</button>
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════
  //  메인 앱
  // ══════════════════════════════════════════════════════════════════
  const tabs=[
    {id:"calendar",label:"📅 달력"},
    ...(selectedDate&&selData?.active?[{id:"detail",label:"📍 신청현황"},...(isAdmin?[{id:"schedule",label:"⏱ 시간표"}]:[])]: []),
    ...(isAdmin?[{id:"admin",label:"⚙️ 관리"}]:[]),
  ];

  return (
    <div style={S.page}>
      {/* ── SMS 모달 */}
      {smsModal&&(
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:17,marginBottom:4}}>{smsModal.type==="cancel"?"❌ 취소 안내 문자":smsModal.type==="leader"?"👑 인도자 단체 안내 문자":"📱 시간표 문자 발송"}</div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:14}}>{fmt(smsModal.dk)}{smsModal.locIdx!=null?" · "+locationNames[smsModal.locIdx]:""}</div>
            <div style={{fontSize:12,color:"#818cf8",fontWeight:700,marginBottom:8}}>수신자</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
              {(()=>{
                let names=smsModal.type==="schedule"?registrations[smsModal.dk]?.[smsModal.locIdx]||[]:smsModal.type==="leader"?(registrations[smsModal.dk]?.[smsModal.locIdx]||[]).filter(n=>n!==currentUser?.name):[...new Set(Object.values(registrations[smsModal.dk]||{}).flat())];
                return names.map((name,i)=>{const mem=members.find(m=>m.name===name);return(
                  <div key={i} style={{background:"rgba(99,102,241,0.15)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:20,padding:"4px 12px",fontSize:12}}>
                    {name} {mem?.phone?<span style={{color:"#818cf8"}}>({mem.phone})</span>:<span style={{color:"#f87171"}}>번호없음</span>}
                  </div>);});
              })()}
            </div>
            <div style={{fontSize:12,color:"#818cf8",fontWeight:700,marginBottom:6}}>메시지</div>
            <textarea style={{...S.textarea,height:180}} value={smsModal.text} onChange={e=>setSmsModal(p=>({...p,text:e.target.value}))}/>
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button onClick={()=>setSmsModal(null)} style={{...S.ghostSm,flex:1,padding:"10px"}}>닫기</button>
              <button onClick={sendSms} style={{...S.applyBtn,flex:2,padding:"10px"}}>📤 발송 / 복사</button>
            </div>
            <p style={{fontSize:11,color:"#374151",marginTop:6,textAlign:"center"}}>* 번호 등록 시 SMS 앱 · 미등록 시 클립보드 복사</p>
          </div>
        </div>
      )}

      {/* ── 취소 모달 */}
      {cancelModal&&(
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:17,marginBottom:4}}>❌ 봉사 취소 처리</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:16}}>{fmt(cancelModal.dk)}</div>
            <div style={{fontSize:13,color:"#818cf8",fontWeight:700,marginBottom:10}}>취소 사유</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
              {CANCEL_REASONS.map(r=>(
                <button key={r} onClick={()=>setCancelReason(r)} style={{...S.ghostSm,borderColor:cancelReason===r?"#818cf8":"rgba(255,255,255,0.12)",color:cancelReason===r?"#818cf8":"#64748b",background:cancelReason===r?"rgba(99,102,241,0.15)":"transparent"}}>{r}</button>
              ))}
            </div>
            {cancelReason==="기타"&&<input style={{...S.input,marginBottom:12}} placeholder="직접 입력..." value={cancelCustom} onChange={e=>setCancelCustom(e.target.value)}/>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setCancelModal(null)} style={{...S.ghostSm,flex:1,padding:"10px"}}>닫기</button>
              <button onClick={confirmCancel} style={{background:"linear-gradient(90deg,#dc2626,#f87171)",border:"none",borderRadius:10,color:"#fff",padding:"10px",flex:2,fontWeight:800,fontSize:14,cursor:"pointer"}}>취소 처리 및 문자 발송</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 헤더 */}
      <header style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={S.hIcon}>📋</div>
          <div><div style={{fontWeight:800,fontSize:15}}>전시대 봉사</div><div style={{fontSize:10,color:"#64748b"}}>Exhibition Booth</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={S.userBadge}>
            {isAdmin?"🔑":"👤"} {currentUser?.name}
            {currentUser?.gender&&<GenderBadge gender={currentUser.gender}/>}
            {currentUser?.isLeader&&<LeaderBadge/>}
            {isAdmin&&<span style={S.adminTag}>관리자</span>}
          </div>
          <button onClick={logout} style={S.ghostSm}>나가기</button>
        </div>
      </header>

      {/* ── 탭 바 */}
      <div style={S.tabBar}>
        {tabs.map(t=><button key={t.id} onClick={()=>setAppTab(t.id)} style={{...S.tabItem,...(appTab===t.id?S.tabOn:{})}}>{t.label}</button>)}
      </div>

      <main style={S.main}>

        {/* ════ 달력 ═══════════════════════════════════════════ */}
        {appTab==="calendar"&&(
          <div>
            <div style={S.calNav}>
              <button style={S.arrowBtn} onClick={()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);}}>‹</button>
              <span style={{fontWeight:800,fontSize:18}}>{year}년 {MON[month]}</span>
              <button style={S.arrowBtn} onClick={()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);}}>›</button>
            </div>
            <div style={S.calGrid}>
              {DAY.map((d,i)=><div key={d} style={{...S.dayName,color:i===0?"#f87171":i===6?"#60a5fa":"#64748b"}}>{d}</div>)}
              {Array.from({length:firstDow}).map((_,i)=><div key={`g${i}`}/>)}
              {Array.from({length:daysInMonth}).map((_,i)=>{
                const day=i+1,dk=dkOf(year,month,day),d=serviceDates[dk];
                const active=d?.active,cancelled=d?.cancelled;
                const isToday=dk===todayKey,isSel=dk===selectedDate;
                const dow=new Date(year,month,day).getDay();
                const holiday=KR_HOLIDAYS[dk];
                const totalR=active?Object.values(registrations[dk]||{}).reduce((a,arr)=>a+arr.length,0):0;
                const myR=active&&currentUser?Object.values(registrations[dk]||{}).some(arr=>arr.includes(currentUser.name)):false;
                const dlPassed=active&&!cancelled&&isDeadlinePassed(dk);
                return (
                  <div key={dk} onClick={()=>{if(active||isAdmin){setSelectedDate(dk);if(active)setAppTab("detail");}}}
                    style={{...S.calCell,background:cancelled?"rgba(239,68,68,0.1)":isSel?"linear-gradient(135deg,#0ea5e9,#6366f1)":active?"rgba(99,102,241,0.15)":"rgba(255,255,255,0.02)",border:isToday?"2px solid #6366f1":cancelled?"1px solid rgba(239,68,68,0.4)":active?"1px solid rgba(99,102,241,0.35)":"1px solid rgba(255,255,255,0.05)",cursor:(active||isAdmin)?"pointer":"default",opacity:!active&&!isAdmin?0.3:1}}>
                    <span style={{fontSize:13,fontWeight:isToday?800:500,color:cancelled?"#f87171":holiday?"#fb923c":dow===0?"#fca5a5":dow===6?"#93c5fd":"#e2e8f0"}}>{day}</span>
                    {holiday&&!cancelled&&<div style={{fontSize:7,color:"#fb923c",maxWidth:"90%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1,marginTop:1}}>{holiday}</div>}
                    {cancelled&&<div style={{fontSize:8,color:"#f87171",fontWeight:800,marginTop:1}}>취소</div>}
                    {active&&!cancelled&&totalR>0&&<div style={S.calCount}>{totalR}명</div>}
                    {myR&&!isSel&&!cancelled&&<div style={S.myDot}/>}
                    {dlPassed&&<div style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",fontSize:7,color:"#fbbf24",fontWeight:700,whiteSpace:"nowrap"}}>마감</div>}
                    {isAdmin&&<div onClick={e=>{e.stopPropagation();if(!cancelled)toggleDateActive(dk);}} style={{...S.adminDot,background:active?(cancelled?"rgba(239,68,68,0.6)":"#4f46e5"):"rgba(255,255,255,0.12)"}}>{active?(cancelled?"✕":"ON"):"+"}</div>}
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:12,marginTop:14,flexWrap:"wrap"}}>
              {[{c:"rgba(99,102,241,0.3)",b:"rgba(99,102,241,0.5)",l:"봉사 날짜"},{c:"transparent",b:"#6366f1",l:"오늘"},{c:"rgba(239,68,68,0.2)",b:"rgba(239,68,68,0.5)",l:"취소됨"}].map(x=>(
                <div key={x.l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#64748b"}}><div style={{width:12,height:12,borderRadius:3,background:x.c,border:`1.5px solid ${x.b}`}}/>{x.l}</div>
              ))}
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#64748b"}}><div style={{width:8,height:8,borderRadius:"50%",background:"#fb923c"}}/>공휴일</div>
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#64748b"}}><div style={{width:8,height:8,borderRadius:"50%",background:"#10b981"}}/>내 신청</div>
            </div>
            {/* 카운트다운 */}
            {(()=>{
              const up=Object.entries(serviceDates).filter(([,d])=>d.active&&!d.cancelled)
                .map(([dk,d])=>({dk,d,info:getDeadlineInfo(dk,d.startTime)}))
                .filter(x=>x.info&&!x.info.expired).sort((a,b)=>a.info.diffMs-b.info.diffMs);
              if(!up.length)return null;
              const {dk,d,info}=up[0];const urgent=info.diffMs<3*3600*1000;
              return (
                <div style={{...S.countdownBox,marginTop:16,borderColor:urgent?"rgba(239,68,68,0.5)":"rgba(99,102,241,0.3)",background:urgent?"rgba(239,68,68,0.08)":"rgba(99,102,241,0.08)"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                    <div><div style={{fontSize:12,color:urgent?"#f87171":"#818cf8",fontWeight:700,marginBottom:3}}>{urgent?"⚠️ 신청 마감 임박!":"⏳ 다음 봉사 신청 마감까지"}</div>
                    <div style={{fontSize:12,color:"#94a3b8"}}>{fmt(dk)} · {d.startTime} 시작 (12시간 전 마감)</div></div>
                    {renderCountdown(info,urgent)}
                  </div>
                  {up.length>1&&<div style={{marginTop:8,fontSize:11,color:"#4b5563"}}>외 {up.length-1}개 일정 대기 중</div>}
                </div>
              );
            })()}
            {isAdmin&&<div style={S.infoBox}>💡 날짜 셀 왼쪽 상단 <b style={{color:"#818cf8"}}>+</b> 버튼으로 날짜 활성화</div>}
          </div>
        )}

        {/* ════ 신청현황 ════════════════════════════════════════ */}
        {appTab==="detail"&&selectedDate&&(
          <div>
            <div style={S.pageHead}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{fontWeight:900,fontSize:20}}>📅 {fmt(selectedDate)}</div>
                {selData?.cancelled&&<div style={{background:"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.5)",borderRadius:20,padding:"4px 12px",fontSize:13,color:"#f87171",fontWeight:700}}>❌ 취소 — {selData.cancelReason}</div>}
              </div>
              {selData?.active&&!selData?.cancelled&&<div style={{fontSize:13,color:"#64748b",marginTop:3}}>
                {selData.startTime} 시작 · {selData.totalHours??2}시간 · {(selData.activeLocations||[]).filter(Boolean).length}곳 운영
                {isDeadlinePassed(selectedDate)&&<span style={{color:"#f87171",marginLeft:8,fontWeight:700}}>⛔ 신청 마감</span>}
              </div>}
            </div>
            {selData?.active&&!selData?.cancelled&&!isDeadlinePassed(selectedDate)&&(()=>{
              const info=getDeadlineInfo(selectedDate,selData.startTime);
              if(!info||info.expired)return null;
              const urgent=info.diffMs<3*3600*1000;
              return(<div style={{...S.countdownBox,marginBottom:16,borderColor:urgent?"rgba(239,68,68,0.5)":"rgba(99,102,241,0.3)",background:urgent?"rgba(239,68,68,0.08)":"rgba(99,102,241,0.08)"}}>
                <div style={{fontSize:12,color:urgent?"#f87171":"#818cf8",fontWeight:700,marginBottom:8}}>{urgent?"⚠️ 마감 임박!":"⏳ 신청 마감까지"}</div>
                {renderCountdown(info,urgent)}
              </div>);
            })()}
            {isAdmin&&selData?.active&&(
              <div style={S.adminPanel}>
                <div style={S.aPanelTitle}>🔧 날짜 설정</div>
                {!selData.cancelled?(
                  <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-start"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <span style={S.fl}>전시대 선택</span>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {locationNames.map((locName,locIdx)=>{
                          const on=(selData.activeLocations||[false,false,false,false,false])[locIdx];
                          return(<button key={locIdx} onClick={()=>toggleLocation(selectedDate,locIdx)}
                            style={{...S.nBtn,padding:"4px 10px",height:34,background:on?"linear-gradient(135deg,#4f46e5,#0ea5e9)":"rgba(255,255,255,0.06)",border:`1px solid ${on?"rgba(99,102,241,0.6)":"rgba(255,255,255,0.1)"}`,color:on?"#fff":"#64748b",fontSize:12}}>
                            {on?"✓ ":""}{locName}
                          </button>);
                        })}
                      </div>
                      <div style={{fontSize:11,color:"#4b5563"}}>활성: {(selData.activeLocations||[]).filter(Boolean).length}곳{!(selData.activeLocations||[]).some(Boolean)&&<span style={{color:"#f87171",marginLeft:6}}>⚠️ 최소 1곳 필요</span>}</div>
                    </div>
                    <div style={S.fg}><span style={S.fl}>시작</span><input type="time" value={selData.startTime} onChange={e=>updateDateField(selectedDate,"startTime",e.target.value)} style={S.tInput}/></div>
                    <div style={S.fg}><span style={S.fl}>운영</span>{[1,2,3].map(n=><button key={n} onClick={()=>updateDateField(selectedDate,"totalHours",n)} style={{...S.nBtn,background:(selData.totalHours??2)===n?"#4f46e5":"rgba(255,255,255,0.08)"}}>{n}h</button>)}</div>
                    <div style={{display:"flex",gap:6,marginLeft:"auto",flexWrap:"wrap"}}>
                      <button onClick={()=>setCancelModal({dk:selectedDate})} style={{background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:8,color:"#f87171",padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>❌ 봉사 취소</button>
                      <button onClick={()=>{toggleDateActive(selectedDate);setAppTab("calendar");}} style={S.warnBtn}>닫기</button>
                      <button onClick={()=>deleteDateFully(selectedDate)} style={S.dangerBtn}>삭제</button>
                    </div>
                  </div>
                ):(
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span style={{color:"#f87171",fontWeight:700}}>취소 사유: {selData.cancelReason}</span>
                    <button onClick={()=>undoCancel(selectedDate)} style={{...S.ghostSm,color:"#4ade80",borderColor:"rgba(74,222,128,0.3)"}}>복원</button>
                    <button onClick={()=>setSmsModal({type:"cancel",dk:selectedDate,text:buildCancelSms(selectedDate,selData.cancelReason,selRegs)})} style={{...S.ghostSm,color:"#818cf8"}}>📱 재발송</button>
                  </div>
                )}
              </div>
            )}
            {!selData?.active?<div style={S.empty}>봉사 일정이 없습니다.</div>
            :selData?.cancelled?(<div style={{...S.empty,color:"#ef4444"}}><div style={{fontSize:32,marginBottom:12}}>❌</div><div style={{fontWeight:700,fontSize:16}}>봉사가 취소되었습니다</div><div style={{color:"#64748b",fontSize:13,marginTop:4}}>사유: {selData.cancelReason}</div></div>)
            :getActiveLocIndices(selectedDate).length===0?(<div style={S.empty}><div style={{fontSize:28,marginBottom:10}}>📍</div><div style={{fontWeight:700,color:"#64748b"}}>활성화된 전시대가 없습니다</div>{isAdmin&&<div style={{fontSize:13,color:"#4b5563",marginTop:4}}>위 설정에서 전시대를 선택해주세요</div>}</div>)
            :(getActiveLocIndices(selectedDate).map((locIdx)=>{
              const regs=selRegs[locIdx]||[];
              const isFull=regs.length>=8,meetsMin=regs.length>=4;
              const myReg=regs.includes(currentUser?.name);
              const dlPassed=isDeadlinePassed(selectedDate);
              const pph=Math.ceil(regs.length/2),slotMin=regs.length>=2?Math.floor(60/pph):0;
              const locLeader=selData.leaders?.[locIdx];
              const locLeaderMem=locLeader?members.find(m=>m.name===locLeader):null;
              const hasBro=hasBrotherInLoc(selectedDate,locIdx);
              return (
                <div key={locIdx} style={{...S.locCard,borderColor:hasBro?"rgba(255,255,255,0.07)":"rgba(251,191,36,0.3)"}}>
                  <div style={S.locHead}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontWeight:800,fontSize:17}}>📍 {locationNames[locIdx]}</span>
                      <span style={{...S.statBadge,color:isFull?"#f87171":meetsMin?"#4ade80":"#fbbf24",borderColor:isFull?"#f87171":meetsMin?"#4ade80":"#fbbf24"}}>{regs.length}/8명 {isFull?"· 마감":meetsMin?"· ✓ 최소 충족":"· 최소 4명"}</span>
                      {!hasBro&&regs.length>0&&<span style={{fontSize:11,color:"#fbbf24",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:10,padding:"1px 8px"}}>⚠️ 형제 미배정</span>}
                      {dlPassed&&<span style={{fontSize:11,color:"#f87171",fontWeight:700}}>⛔ 마감</span>}
                    </div>
                    {!isAdmin&&(dlPassed?<span style={{fontSize:12,color:"#4b5563",fontStyle:"italic"}}>마감됨</span>
                      :myReg?<button onClick={()=>unregister(selectedDate,locIdx)} style={S.cancelBtn}>취소</button>
                      :<button onClick={()=>register(selectedDate,locIdx)} disabled={isFull} style={{...S.applyBtn,opacity:isFull?0.4:1,cursor:isFull?"default":"pointer"}}>{isFull?"마감":"신청하기"}</button>
                    )}
                  </div>
                  {locLeaderMem&&(
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.2)",borderRadius:10,padding:"8px 12px",flexWrap:"wrap"}}>
                      <span style={{fontSize:13,color:"#fbbf24",fontWeight:700}}>👑 인도자</span>
                      <span style={{fontWeight:700,fontSize:14}}>{locLeaderMem.name}</span>
                      <GenderBadge gender={locLeaderMem.gender}/>
                      {locLeaderMem.phone&&<span style={{fontSize:12,color:"#818cf8"}}>📱 {locLeaderMem.phone}</span>}
                      {currentUser?.name===locLeaderMem.name&&regs.length>=2&&(
                        <button onClick={()=>{const d=serviceDates[selectedDate];setSmsModal({type:"leader",dk:selectedDate,locIdx,text:buildLeaderNoticeSms(selectedDate,locationNames[locIdx],regs,d.startTime,d.totalHours??2,currentUser.name)});}}
                          style={{marginLeft:"auto",background:"linear-gradient(90deg,#f59e0b,#fbbf24)",border:"none",borderRadius:8,color:"#1c1917",padding:"5px 12px",fontWeight:800,fontSize:12,cursor:"pointer"}}>
                          📢 단체 안내 문자
                        </button>
                      )}
                    </div>
                  )}
                  {!locLeaderMem&&isAdmin&&<div style={{fontSize:12,color:"#fbbf24",marginBottom:8,opacity:0.7}}>👑 인도자 미지정</div>}
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,margin:"8px 0"}}>
                    {regs.length===0&&<span style={{color:"#374151",fontSize:13}}>아직 신청자가 없습니다</span>}
                    {regs.map((name,ni)=>{
                      const mem=members.find(m=>m.name===name);
                      const isMe=name===currentUser?.name,isLdr=selData.leaders?.[locIdx]===name;
                      return(<div key={ni} style={{...S.pTag,background:isMe?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.07)",borderColor:isMe?"#818cf8":"rgba(255,255,255,0.1)"}}>
                        {isMe&&<span style={{color:"#fbbf24"}}>★</span>} {name}
                        {mem?.gender&&<GenderBadge gender={mem.gender}/>}
                        {isLdr&&<LeaderBadge/>}
                        {isAdmin&&(<><button onClick={()=>setLeader(selectedDate,locIdx,name)} title="인도자 지정" style={{background:"transparent",border:"none",cursor:"pointer",fontSize:12,color:isLdr?"#fbbf24":"#4b5563",padding:"0 2px"}}>👑</button><span onClick={()=>adminRemove(selectedDate,locIdx,name)} style={S.rmX}>✕</span></>)}
                      </div>);
                    })}
                  </div>
                  {regs.length>=2&&(
                    <div style={S.preview}>
                      <span>⏰ {pph}팀/시 · {slotMin}분 인터벌 · {selData.totalHours??2}시간</span>
                      {isAdmin&&<div style={{display:"flex",gap:8}}>
                        <button onClick={()=>setAppTab("schedule")} style={S.linkBtn}>시간표 →</button>
                        <button onClick={()=>openScheduleSms(selectedDate,locIdx)} style={{...S.linkBtn,color:"#34d399"}}>📱 문자</button>
                      </div>}
                    </div>
                  )}
                </div>
              );
            }))}
          </div>
        )}

        {/* ════ 시간표 (관리자) ════════════════════════════════ */}
        {appTab==="schedule"&&selectedDate&&selData?.active&&isAdmin&&(
          <div>
            <div style={S.pageHead}><div style={{fontWeight:900,fontSize:20}}>⏱ 시간표 — {fmt(selectedDate)}</div><div style={{fontSize:13,color:"#64748b",marginTop:3}}>1시간 1사이클 · {selData.totalHours??2}시간</div></div>
            {getActiveLocIndices(selectedDate).map((locIdx)=>{
              const regs=selRegs[locIdx]||[];const slots=getSlots(selectedDate,locIdx);
              const hasOv=(selData.scheduleOverrides?.[locIdx]?.length>0);
              const pph=regs.length>=2?Math.ceil(regs.length/2):0,slotMin=pph>0?Math.floor(60/pph):0;
              const locLeader=selData.leaders?.[locIdx];const locLeaderMem=locLeader?members.find(m=>m.name===locLeader):null;
              const hasBro=hasBrotherInLoc(selectedDate,locIdx);
              return(<div key={locIdx} style={S.schBlock}>
                <div style={S.schLocTitle}>
                  {editingLocIdx===locIdx?(
                    <div style={{display:"flex",gap:8,alignItems:"center",flex:1}}>
                      <input style={{...S.tInput,flex:1,fontSize:15,fontWeight:700}} value={editingLocName} onChange={e=>setEditingLocName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveLocName();if(e.key==="Escape")setEditingLocIdx(null);}} autoFocus/>
                      <button onClick={saveLocName} style={S.applyBtn}>저장</button>
                      <button onClick={()=>setEditingLocIdx(null)} style={S.ghostSm}>취소</button>
                    </div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:6,flex:1}}>
                      <span>📍 {locationNames[locIdx]}</span>
                      <button onClick={()=>startEditLoc(locIdx)} style={{...S.ghostSm,fontSize:11,padding:"2px 8px"}}>✏️</button>
                      <span style={{fontWeight:400,fontSize:13,color:"#64748b"}}>{regs.length}명 · {pph}팀/시 · {slotMin}분</span>
                      {!hasBro&&regs.length>0&&<span style={{fontSize:11,color:"#fbbf24",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:8,padding:"1px 8px"}}>⚠️ 형제 없음</span>}
                      {hasOv&&<button onClick={()=>resetSchedule(selectedDate,locIdx)} style={{...S.linkBtn,color:"#f87171"}}>초기화</button>}
                      {regs.length>=2&&<button onClick={()=>openScheduleSms(selectedDate,locIdx)} style={{...S.linkBtn,color:"#34d399"}}>📱 문자</button>}
                    </div>
                  )}
                </div>
                {locLeaderMem&&(
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:12,padding:"10px 14px"}}>
                    <span style={{fontSize:18}}>👑</span>
                    <div><div style={{fontSize:11,color:"#fbbf24",fontWeight:700,marginBottom:2}}>인도자</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontWeight:800,fontSize:15}}>{locLeaderMem.name}</span><GenderBadge gender={locLeaderMem.gender}/>{locLeaderMem.phone&&<span style={{fontSize:13,color:"#818cf8"}}>📱 {locLeaderMem.phone}</span>}</div></div>
                  </div>
                )}
                {regs.length<2?<div style={S.empty}>2명 이상 신청 시 시간표가 생성됩니다.</div>:(
                  <>
                    <div style={S.sumRow}>
                      {regs.map((name,i)=>{const mem=members.find(m=>m.name===name);const cnt=slots.filter(s=>s.pair.includes(name)).length;const isLdr=selData.leaders?.[locIdx]===name;
                        return(<div key={i} style={{...S.sumTag,background:"rgba(255,255,255,0.05)",borderColor:"rgba(255,255,255,0.1)"}}>
                          {isLdr&&<span style={{color:"#fbbf24",fontSize:11}}>👑</span>}{name}{mem?.gender&&<GenderBadge gender={mem.gender}/>}<span style={{marginLeft:4,background:"#1e293b",borderRadius:10,padding:"1px 6px",fontSize:11,color:"#94a3b8"}}>{cnt}회</span>
                        </div>);
                      })}
                    </div>
                    {slots.map((slot,si)=>{
                      const showDiv=si>0&&slot.cycle!==slots[si-1].cycle;
                      return(<div key={si}>
                        {showDiv&&(<div style={{display:"flex",alignItems:"center",gap:8,margin:"10px 0 6px"}}><div style={{flex:1,height:1,background:"rgba(99,102,241,0.3)"}}/><span style={{fontSize:11,color:"#818cf8",fontWeight:700}}>{slot.cycle}시간차</span><div style={{flex:1,height:1,background:"rgba(99,102,241,0.3)"}}/></div>)}
                        <div style={{...S.slotRow,background:si%2===0?"rgba(255,255,255,0.03)":"rgba(255,255,255,0.01)",border:"1px solid rgba(255,255,255,0.06)"}}>
                          <div style={S.slotNum}>{si+1}</div>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
                              <input type="time" value={slot.start} onChange={e=>updateSlot(selectedDate,locIdx,si,"start",e.target.value)} style={S.slotTInput}/>
                              <span style={{color:"#64748b"}}>~</span>
                              <input type="time" value={slot.end} onChange={e=>updateSlot(selectedDate,locIdx,si,"end",e.target.value)} style={S.slotTInput}/>
                            </div>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                              {slot.pair.map((name,pi)=>{const mem=members.find(m=>m.name===name);const isLdr=selData.leaders?.[locIdx]===name;
                                return(<span key={pi} style={{...S.slotName,background:"rgba(255,255,255,0.1)",border:"1px solid transparent",display:"inline-flex",alignItems:"center",gap:4}}>
                                  {isLdr&&<span style={{color:"#fbbf24",fontSize:11}}>👑</span>}{name}{mem?.gender&&<GenderBadge gender={mem.gender}/>}
                                </span>);
                              })}
                            </div>
                          </div>
                        </div>
                      </div>);
                    })}
                    <div style={{fontSize:11,color:"#374151",marginTop:10,textAlign:"right"}}>총 {slots.length}슬롯 · {slotMin}분 간격</div>
                  </>
                )}
              </div>);
            })}
          </div>
        )}

        {/* ════ 관리 탭 ════════════════════════════════════════ */}
        {appTab==="admin"&&isAdmin&&(
          <div>
            <div style={S.pageHead}><div style={{fontWeight:900,fontSize:20}}>⚙️ 회원 관리</div></div>
            <div style={S.adminPanel}>
              <div style={S.aPanelTitle}>📍 전시대 이름</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {locationNames.map((name,idx)=>(
                  <div key={idx} style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.05)",borderRadius:10,padding:"8px 12px",border:"1px solid rgba(255,255,255,0.1)"}}>
                    {editingLocIdx===idx?(
                      <><input style={{...S.tInput,minWidth:120}} value={editingLocName} onChange={e=>setEditingLocName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveLocName();if(e.key==="Escape")setEditingLocIdx(null);}} autoFocus/>
                      <button onClick={saveLocName} style={{...S.applyBtn,padding:"4px 10px",fontSize:12}}>저장</button>
                      <button onClick={()=>setEditingLocIdx(null)} style={{...S.ghostSm,padding:"4px 8px"}}>✕</button></>
                    ):(<><span style={{fontWeight:700,fontSize:14}}>{idx+1}. {name}</span><button onClick={()=>startEditLoc(idx)} style={{...S.ghostSm,padding:"3px 8px",fontSize:11}}>✏️</button></>)}
                  </div>
                ))}
              </div>
            </div>
            <div style={S.adminPanel}>
              <div style={S.aPanelTitle}>➕ 새 회원 추가</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:110}}><span style={{fontSize:11,color:"#64748b"}}>이름</span><input style={{...S.input,marginBottom:0}} placeholder="이름" value={nm} onChange={e=>setNm(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMember()}/></div>
                <div style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:120}}><span style={{fontSize:11,color:"#64748b"}}>전화번호</span><input style={{...S.input,marginBottom:0}} placeholder="010-xxxx-xxxx" value={nph} onChange={e=>setNph(e.target.value)}/></div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <span style={{fontSize:11,color:"#64748b"}}>성별</span>
                  <div style={{display:"flex",gap:4}}>
                    {["형제","자매"].map(g=><button key={g} onClick={()=>setNgen(g)} style={{...S.nBtn,background:ngen===g?(g==="형제"?"rgba(59,130,246,0.4)":"rgba(236,72,153,0.4)"):"rgba(255,255,255,0.08)",color:ngen===g?(g==="형제"?"#60a5fa":"#f472b6"):"#e2e8f0",border:`1px solid ${ngen===g?(g==="형제"?"rgba(59,130,246,0.5)":"rgba(236,72,153,0.5)"):"rgba(255,255,255,0.1)"}`,padding:"0 12px"}}>{g}</button>)}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#94a3b8",cursor:"pointer",whiteSpace:"nowrap"}}><input type="checkbox" checked={nldr} onChange={e=>setNldr(e.target.checked)}/>인도자</label>
                  <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#94a3b8",cursor:"pointer",whiteSpace:"nowrap"}}><input type="checkbox" checked={nadm} onChange={e=>setNadm(e.target.checked)}/>관리자</label>
                  <button onClick={addMember} style={S.applyBtn}>추가</button>
                </div>
              </div>
            </div>
            <div style={{fontWeight:700,fontSize:13,color:"#64748b",marginBottom:8}}>전체 회원 ({members.length}명) — 형제 {members.filter(m=>m.gender==="형제").length}명 · 자매 {members.filter(m=>m.gender==="자매").length}명</div>
            <div style={S.memberList}>
              {members.map((m,i)=>(
                <div key={i} style={S.memberRow}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>
                    <div style={{...S.avatar,background:m.gender==="형제"?"linear-gradient(135deg,#3b82f6,#6366f1)":"linear-gradient(135deg,#ec4899,#a855f7)",flexShrink:0}}>{m.name[0]}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontWeight:700,fontSize:15}}>{m.name}</span>
                        {m.gender&&<GenderBadge gender={m.gender}/>}
                        {m.isLeader&&<LeaderBadge/>}
                        {m.isAdmin&&<span style={{...S.adminTag,marginLeft:0}}>관리자</span>}
                      </div>
                      {editPhoneIdx===i?(
                        <div style={{display:"flex",gap:6,marginTop:4}}>
                          <input style={{...S.tInput,flex:1,fontSize:12}} value={editPhoneVal} onChange={e=>setEditPhoneVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")savePhone(m.name);}} placeholder="010-xxxx-xxxx" autoFocus/>
                          <button onClick={()=>savePhone(m.name)} style={{...S.applyBtn,padding:"3px 8px",fontSize:11}}>저장</button>
                          <button onClick={()=>setEditPhoneIdx(null)} style={{...S.ghostSm,padding:"3px 6px"}}>✕</button>
                        </div>
                      ):(
                        <div style={{fontSize:12,color:m.phone?"#818cf8":"#374151",marginTop:2,cursor:"pointer"}} onClick={()=>{setEditPhoneIdx(i);setEditPhoneVal(m.phone||"");}}>📱 {m.phone||"번호 추가"}</div>
                      )}
                    </div>
                  </div>
                  {m.name!=="관리자"&&(
                    <div style={{display:"flex",gap:4,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      <button onClick={()=>toggleMemberLeader(m.name)} style={{...S.ghostSm,color:m.isLeader?"#fbbf24":"#64748b",borderColor:m.isLeader?"rgba(251,191,36,0.4)":"rgba(255,255,255,0.12)"}}>{m.isLeader?"인도자 ✓":"인도자"}</button>
                      <button onClick={()=>toggleMemberAdmin(m.name)} style={S.ghostSm}>{m.isAdmin?"관리자 ✓":"관리자"}</button>
                      <button onClick={()=>removeMember(m.name)} style={{...S.ghostSm,color:"#f87171",borderColor:"rgba(248,113,113,0.3)"}}>삭제</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{fontWeight:700,fontSize:13,color:"#64748b",margin:"24px 0 8px"}}>봉사 일정</div>
            {Object.entries(serviceDates).filter(([,d])=>d.active).length===0
              ?<div style={S.empty}>활성화된 봉사 날짜가 없습니다.</div>
              :Object.entries(serviceDates).filter(([,d])=>d.active).sort().map(([dk,d])=>{
                const totalR=Object.values(registrations[dk]||{}).reduce((a,arr)=>a+arr.length,0);
                return(<div key={dk} style={{...S.dateRow,borderColor:d.cancelled?"rgba(239,68,68,0.3)":"rgba(255,255,255,0.07)"}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{fontWeight:700,fontSize:15}}>{fmt(dk)}</div>{d.cancelled&&<span style={{fontSize:11,color:"#f87171",background:"rgba(239,68,68,0.15)",borderRadius:10,padding:"1px 6px",fontWeight:700}}>취소</span>}</div>
                    <div style={{fontSize:12,color:"#64748b",marginTop:2}}>{d.startTime} · {d.totalHours??2}시간 · {(d.activeLocations||[]).filter(Boolean).length}곳 · {totalR}명{d.cancelled&&<span style={{color:"#f87171"}}> · {d.cancelReason}</span>}</div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <button onClick={()=>{setSelectedDate(dk);setAppTab("detail");}} style={S.ghostSm}>상세</button>
                    {!d.cancelled&&<button onClick={()=>setCancelModal({dk})} style={{...S.ghostSm,color:"#f87171",borderColor:"rgba(248,113,113,0.3)"}}>취소</button>}
                    {d.cancelled&&<button onClick={()=>undoCancel(dk)} style={{...S.ghostSm,color:"#4ade80",borderColor:"rgba(74,222,128,0.3)"}}>복원</button>}
                    <button onClick={()=>deleteDateFully(dk)} style={{...S.ghostSm,color:"#f87171",borderColor:"rgba(248,113,113,0.3)"}}>삭제</button>
                  </div>
                </div>);
              })
            }
          </div>
        )}
      </main>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
const S={
  page:{minHeight:"100vh",background:"linear-gradient(160deg,#060611 0%,#0c1628 60%,#060d1a 100%)",color:"#e2e8f0",fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif"},
  loginWrap:{maxWidth:420,margin:"0 auto",padding:"48px 20px"},
  logoBox:{width:72,height:72,borderRadius:20,background:"linear-gradient(135deg,#0ea5e9,#6366f1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto",boxShadow:"0 12px 40px rgba(99,102,241,0.5)"},
  logoTitle:{fontWeight:900,fontSize:24,margin:"0 0 6px",color:"#f1f5f9",letterSpacing:"-0.5px"},
  logoSub:{color:"#6366f1",fontSize:12,margin:0,fontWeight:700,letterSpacing:"0.5px"},
  modeRow:{display:"flex",gap:10,marginBottom:16},
  modeBtn:{flex:1,padding:"18px 12px",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,background:"rgba(255,255,255,0.04)",color:"#94a3b8",cursor:"pointer",textAlign:"center"},
  modeBtnOn:{background:"linear-gradient(135deg,rgba(14,165,233,0.2),rgba(99,102,241,0.2))",border:"1px solid rgba(99,102,241,0.5)",color:"#e2e8f0",boxShadow:"0 4px 20px rgba(99,102,241,0.2)"},
  loginCard:{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:24},
  label:{display:"block",fontSize:13,color:"#94a3b8",marginBottom:8,fontWeight:600},
  hint:{fontSize:12,color:"#374151",marginTop:8},
  input:{width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,color:"#e2e8f0",padding:"12px 14px",fontSize:15,outline:"none"},
  errMsg:{color:"#f87171",fontSize:13,marginTop:8,lineHeight:1.5},
  loginBtn:{width:"100%",marginTop:16,padding:14,background:"linear-gradient(90deg,#0ea5e9,#6366f1)",border:"none",borderRadius:12,color:"#fff",fontWeight:800,fontSize:16,cursor:"pointer",boxShadow:"0 4px 20px rgba(99,102,241,0.4)"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16},
  modal:{background:"linear-gradient(160deg,#0f172a,#1e1b4b)",border:"1px solid rgba(99,102,241,0.4)",borderRadius:20,padding:28,width:"100%",maxWidth:520,boxShadow:"0 24px 80px rgba(0,0,0,0.6)",maxHeight:"90vh",overflowY:"auto"},
  textarea:{width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,color:"#e2e8f0",padding:"12px 14px",fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit",lineHeight:1.6},
  header:{background:"rgba(6,6,17,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100},
  hIcon:{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#0ea5e9,#6366f1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16},
  userBadge:{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"6px 14px",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6},
  adminTag:{background:"#4f46e5",borderRadius:6,padding:"1px 6px",fontSize:10,fontWeight:800,marginLeft:4},
  ghostSm:{background:"transparent",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#64748b",padding:"6px 12px",fontSize:12,cursor:"pointer",fontWeight:600},
  tabBar:{display:"flex",background:"rgba(6,6,17,0.8)",borderBottom:"1px solid rgba(255,255,255,0.05)",padding:"0 16px",overflowX:"auto"},
  tabItem:{padding:"13px 16px",border:"none",borderBottom:"2px solid transparent",background:"transparent",color:"#374151",fontSize:13,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"},
  tabOn:{color:"#818cf8",borderBottomColor:"#6366f1"},
  main:{maxWidth:780,margin:"0 auto",padding:"20px 16px"},
  calNav:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16},
  arrowBtn:{width:36,height:36,borderRadius:8,border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.04)",color:"#e2e8f0",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  calGrid:{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4},
  dayName:{textAlign:"center",fontSize:12,fontWeight:700,padding:"4px 0 8px"},
  calCell:{aspectRatio:"1",borderRadius:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative",transition:"all 0.15s"},
  calCount:{fontSize:9,background:"#6366f1",borderRadius:8,padding:"0 4px",marginTop:1,fontWeight:700,color:"#fff"},
  myDot:{width:5,height:5,borderRadius:"50%",background:"#10b981",position:"absolute",bottom:4,right:4},
  adminDot:{position:"absolute",top:2,left:2,fontSize:8,borderRadius:3,padding:"1px 3px",cursor:"pointer",fontWeight:800,color:"#fff"},
  countdownBox:{borderRadius:14,padding:"14px 16px",border:"1px solid"},
  infoBox:{marginTop:12,background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#64748b"},
  pageHead:{marginBottom:20},
  adminPanel:{background:"rgba(79,70,229,0.08)",border:"1px solid rgba(79,70,229,0.25)",borderRadius:14,padding:16,marginBottom:16},
  aPanelTitle:{fontWeight:700,fontSize:13,color:"#818cf8",marginBottom:12},
  fg:{display:"flex",alignItems:"center",gap:6},
  fl:{fontSize:13,color:"#64748b",whiteSpace:"nowrap"},
  nBtn:{height:32,padding:"0 10px",borderRadius:8,border:"1px solid rgba(255,255,255,0.1)",cursor:"pointer",color:"#e2e8f0",fontWeight:700,fontSize:13,background:"rgba(255,255,255,0.08)"},
  tInput:{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,color:"#e2e8f0",padding:"5px 8px",fontSize:13,outline:"none"},
  warnBtn:{background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:8,color:"#fbbf24",padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"},
  dangerBtn:{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,color:"#f87171",padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"},
  locCard:{background:"rgba(255,255,255,0.03)",border:"1px solid",borderRadius:16,padding:16,marginBottom:12},
  locHead:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8},
  statBadge:{fontSize:12,border:"1px solid",borderRadius:20,padding:"2px 8px"},
  applyBtn:{background:"linear-gradient(90deg,#0ea5e9,#6366f1)",border:"none",borderRadius:8,color:"#fff",padding:"8px 16px",fontWeight:700,fontSize:13,cursor:"pointer"},
  cancelBtn:{background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,color:"#f87171",padding:"8px 14px",fontWeight:700,fontSize:13,cursor:"pointer"},
  pTag:{borderRadius:20,padding:"4px 10px",fontSize:13,border:"1px solid",display:"flex",alignItems:"center",gap:4},
  rmX:{color:"#f87171",fontSize:10,cursor:"pointer",marginLeft:2,fontWeight:700},
  preview:{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"},
  linkBtn:{background:"transparent",border:"none",color:"#818cf8",fontSize:12,cursor:"pointer",fontWeight:700,padding:0},
  schBlock:{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:16,padding:20,marginBottom:16},
  schLocTitle:{fontWeight:800,fontSize:16,marginBottom:12,paddingBottom:10,borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",flexWrap:"wrap",gap:4},
  sumRow:{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12},
  sumTag:{borderRadius:20,padding:"4px 10px",fontSize:12,border:"1px solid",display:"flex",alignItems:"center",gap:4},
  slotRow:{display:"flex",alignItems:"flex-start",gap:12,borderRadius:10,padding:"10px 14px",marginBottom:4},
  slotNum:{minWidth:26,height:26,borderRadius:"50%",background:"linear-gradient(135deg,#0ea5e9,#6366f1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",flexShrink:0},
  slotTInput:{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,color:"#e2e8f0",padding:"3px 6px",fontSize:13,outline:"none"},
  slotName:{borderRadius:20,padding:"3px 8px",fontSize:13},
  empty:{textAlign:"center",color:"#374151",padding:"32px 0",fontSize:14},
  memberList:{background:"rgba(255,255,255,0.02)",borderRadius:14,border:"1px solid rgba(255,255,255,0.07)",overflow:"hidden"},
  memberRow:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:"1px solid rgba(255,255,255,0.05)",gap:8},
  avatar:{width:38,height:38,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,color:"#fff"},
  dateRow:{display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"14px 16px",marginBottom:8,border:"1px solid"},
};
