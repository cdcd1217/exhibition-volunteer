import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

// ══════════════════════════════════════════════════════════════════════
const ADMIN_PASSWORD = "admin1234";
const DEFAULT_LOCATION_NAMES = ["A 전시대", "B 전시대", "C 전시대", "D 전시대", "E 전시대"];
const CANCEL_REASONS = ["날씨 불량", "인원 부족", "인도자 없음", "장소 사정", "기타"];
const DAY_KO = ["일","월","화","수","목","금","토"];
const DAY_KO_FULL = ["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
const MON_KO = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

// 세션 타입
const SESSION_TYPES = [
  { id: "morning", label: "🌅 오전", color: "#f59e0b" },
  { id: "evening", label: "🌆 오후/저녁", color: "#6366f1" },
];

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

// 날짜 포맷 - 연도 없이 월/일/요일
function fmt(dk) {
  if (!dk) return "";
  const [y,mo,d]=dk.split("-").map(Number);
  const dow = new Date(y,mo-1,d).getDay();
  return `${mo}월 ${d}일 (${DAY_KO[dow]})`;
}
function fmtFull(dk) {
  if (!dk) return "";
  const [y,mo,d]=dk.split("-").map(Number);
  const dow = new Date(y,mo-1,d).getDay();
  return { month:mo, day:d, dayKo: DAY_KO_FULL[dow], dowIdx: dow };
}
function dkOf(y,mo,d) { return `${y}-${String(mo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }

function buildCancelSms(dk, reason, registrations) {
  const names=[...new Set(Object.values(registrations||{}).flat())];
  return `[전시대 봉사 취소 안내]\n\n📅 ${fmt(dk)} 전시대 봉사가 취소되었습니다.\n\n❌ 취소 사유: ${reason}\n\n참여 신청해 주신 분들께 감사드리며,\n다음 기회에 함께하도록 하겠습니다.\n\n신청자: ${names.join(", ")}`;
}
function buildScheduleSms(dk, locName, slots, startTime, totalHours, sessionLabel) {
  let txt = `[전시대 봉사 시간표]\n📅 ${fmt(dk)} ${sessionLabel||""}\n📍 ${locName}\n⏰ ${startTime} 시작 (${totalHours}시간)\n\n`;
  slots.forEach(s=>{ txt+=`${s.slotIndex}. ${s.start}~${s.end}  ${s.pair.join(", ")}\n`; });
  return txt + `\n봉사에 참여해 주셔서 감사합니다.`;
}
function buildLeaderNoticeSms(dk, locName, regs, startTime, totalHours, leaderName, sessionLabel) {
  let txt = `[전시대 봉사 안내]\n\n안녕하세요, ${leaderName} 인도자입니다.\n\n`;
  txt += `📅 ${fmt(dk)} ${sessionLabel||""}\n📍 ${locName}\n⏰ ${startTime} 시작 (${totalHours}시간)\n\n함께 봉사할 분들:\n`;
  regs.forEach((name, i) => { txt += `  ${i+1}. ${name}\n`; });
  return txt + `\n시간에 맞춰 함께해 주세요. 감사합니다!`;
}

const today=new Date();
const todayKey=dkOf(today.getFullYear(),today.getMonth(),today.getDate());

const GenderBadge = ({gender}) => (
  <span style={{fontSize:11,fontWeight:700,borderRadius:8,padding:"2px 7px",background:gender==="형제"?"#dbeafe":"#fce7f3",color:gender==="형제"?"#1d4ed8":"#be185d",border:`1px solid ${gender==="형제"?"#93c5fd":"#f9a8d4"}`}}>{gender}</span>
);
const LeaderBadge = () => (
  <span style={{fontSize:11,fontWeight:700,borderRadius:8,padding:"2px 7px",background:"#fef3c7",color:"#92400e",border:"1px solid #fcd34d"}}>인도자</span>
);
const Spinner = () => (
  <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 0",gap:16}}>
    <div style={{width:48,height:48,border:"4px solid #bfdbfe",borderTop:"4px solid #2563eb",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <p style={{color:"#3b82f6",fontSize:15,fontWeight:600}}>잠시만 기다려주세요...</p>
  </div>
);

// ══════════════════════════════════════════════════════════════════════
export default function App() {
  const [screen,setScreen]=useState("login");
  const [currentUser,setCurrentUser]=useState(null);
  const [members,setMembers]=useState([]);
  const [loginInput,setLoginInput]=useState("");
  const [adminPwInput,setAdminPwInput]=useState("");
  const [loginMode,setLoginMode]=useState("member");
  const [loginError,setLoginError]=useState("");
  const [loading,setLoading]=useState(true);

  const [year,setYear]=useState(today.getFullYear());
  const [month,setMonth]=useState(today.getMonth());
  const [selectedDate,setSelectedDate]=useState(null);
  const [selectedSession,setSelectedSession]=useState(null); // "morning"|"evening"|null
  const [appTab,setAppTab]=useState("calendar");

  // serviceDates[dk] = {
  //   active, activeLocations, cancelled, cancelReason,
  //   sessions: {
  //     morning: { active, startTime, totalHours, leaders:{}, scheduleOverrides:{} },
  //     evening: { active, startTime, totalHours, leaders:{}, scheduleOverrides:{} }
  //   }
  // }
  const [serviceDates,setServiceDates]=useState({});
  // registrations[dk][sessionId][locIdx] = [names]
  const [registrations,setRegistrations]=useState({});
  const [locationNames,setLocationNames]=useState([...DEFAULT_LOCATION_NAMES]);

  const [editingLocIdx,setEditingLocIdx]=useState(null);
  const [editingLocName,setEditingLocName]=useState("");
  const [nm,setNm]=useState(""); const [nph,setNph]=useState("");
  const [ngen,setNgen]=useState("형제"); const [nadm,setNadm]=useState(false); const [nldr,setNldr]=useState(false);
  const [editPhoneIdx,setEditPhoneIdx]=useState(null); const [editPhoneVal,setEditPhoneVal]=useState("");
  const [smsModal,setSmsModal]=useState(null);
  const [cancelModal,setCancelModal]=useState(null);
  const [cancelReason,setCancelReason]=useState(CANCEL_REASONS[0]);
  const [cancelCustom,setCancelCustom]=useState("");

  // 공지사항: [{id, title, content, pinned, createdAt}]
  const [notices,setNotices]=useState([]);
  const [noticeModal,setNoticeModal]=useState(null); // null | {mode:"new"|"edit", notice?}
  const [noticeTitle,setNoticeTitle]=useState("");
  const [noticeContent,setNoticeContent]=useState("");
  const [noticePinned,setNoticePinned]=useState(false);
  const [now,setNow]=useState(new Date());

  const daysInMonth=useMemo(()=>new Date(year,month+1,0).getDate(),[year,month]);
  const firstDow=useMemo(()=>new Date(year,month,1).getDay(),[year,month]);
  const isAdmin=currentUser?.isAdmin;
  const selData=selectedDate?serviceDates[selectedDate]:null;
  const selRegs=selectedDate?(registrations[selectedDate]||{}):{}; // {sessionId:{locIdx:[names]}}

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);

  // ── DB 로드 ─────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, sdRes, regRes, setRes] = await Promise.all([
        supabase.from("members").select("*").order("created_at"),
        supabase.from("service_dates").select("*"),
        supabase.from("registrations").select("*"),
        supabase.from("settings").select("*"),
      ]);
      if (mRes.data) setMembers(mRes.data.map(m=>({name:m.name,phone:m.phone||"",gender:m.gender||"형제",isAdmin:m.is_admin,isLeader:m.is_leader,id:m.id})));
      if (sdRes.data) {
        const sd={};
        sdRes.data.forEach(row=>{
          sd[row.date_key]={
            active:row.active,
            activeLocations:row.active_locations||[true,false,false,false,false],
            cancelled:row.cancelled, cancelReason:row.cancel_reason,
            sessions:row.leaders && typeof row.leaders==="object" && row.leaders.sessions
              ? row.leaders.sessions
              : {
                  morning:{active:false,startTime:"09:00",totalHours:2,leaders:{},scheduleOverrides:{}},
                  evening:{active:false,startTime:"14:00",totalHours:2,leaders:{},scheduleOverrides:{}}
                },
          };
        });
        setServiceDates(sd);
      }
      if (regRes.data) {
        const regs={};
        regRes.data.forEach(row=>{
          if(!regs[row.date_key]) regs[row.date_key]={};
          const sess = row.member_name && row.member_name.startsWith("__sess__")
            ? row.member_name.split("__")[2] : "morning"; // legacy support
          const sessionId = row.session_id || "morning";
          if(!regs[row.date_key][sessionId]) regs[row.date_key][sessionId]={};
          if(!regs[row.date_key][sessionId][row.loc_idx]) regs[row.date_key][sessionId][row.loc_idx]=[];
          if(row.member_name && !row.member_name.startsWith("__sess__"))
            regs[row.date_key][sessionId][row.loc_idx].push(row.member_name);
        });
        setRegistrations(regs);
      }
      if (setRes.data) {
        const locSetting=setRes.data.find(s=>s.key==="location_names");
        if(locSetting?.value) setLocationNames(locSetting.value);
        const noticeSetting=setRes.data.find(s=>s.key==="notices");
        if(noticeSetting?.value) setNotices(noticeSetting.value);
      }
    } catch(e){console.error("loadAll error:",e);}
    setLoading(false);
  },[]);

  useEffect(()=>{loadAll();},[loadAll]);

  useEffect(()=>{
    const sub=supabase.channel("realtime-all")
      .on("postgres_changes",{event:"*",schema:"public",table:"registrations"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"service_dates"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"members"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"settings"},loadAll)
      .subscribe();
    return()=>supabase.removeChannel(sub);
  },[loadAll]);

  // ── 로그인 ──────────────────────────────────────────────────────────
  const handleLogin=async()=>{
    setLoginError("");
    if(loginMode==="admin"){
      if(adminPwInput!==ADMIN_PASSWORD){setLoginError("비밀번호가 틀렸습니다.");return;}
      setCurrentUser({name:"관리자",isAdmin:true,gender:"형제",isLeader:true});
      setScreen("app");
    } else {
      const name=loginInput.trim();
      if(!name){setLoginError("이름을 입력하세요.");return;}
      const found=members.find(m=>m.name===name);
      if(!found){setLoginError("등록된 이름이 아닙니다.\n관리자에게 문의하세요.");return;}
      setCurrentUser(found);setScreen("app");
    }
  };
  const logout=()=>{setCurrentUser(null);setScreen("login");setLoginInput("");setAdminPwInput("");setLoginError("");setLoginMode("member");setSelectedDate(null);setSelectedSession(null);setAppTab("calendar");};

  // ── 날짜 / 세션 관리 ─────────────────────────────────────────────────
  const getDateSessions=(dk)=>serviceDates[dk]?.sessions||{morning:{active:false,startTime:"09:00",totalHours:2,leaders:{},scheduleOverrides:{}},evening:{active:false,startTime:"14:00",totalHours:2,leaders:{},scheduleOverrides:{}}};

  const saveDateToDb=async(dk, patch)=>{
    const ex=serviceDates[dk];
    if(ex){
      await supabase.from("service_dates").update(patch).eq("date_key",dk);
    } else {
      await supabase.from("service_dates").insert({date_key:dk,active:true,active_locations:[true,false,false,false,false],cancelled:false,cancel_reason:"",...patch});
    }
    await loadAll();
  };

  const toggleDateActive=async(dk)=>{
    const ex=serviceDates[dk];
    if(ex?.active){
      await saveDateToDb(dk,{active:false});
    } else if(ex){
      await saveDateToDb(dk,{active:true});
    } else {
      const sessions={morning:{active:false,startTime:"09:00",totalHours:2,leaders:{},scheduleOverrides:{}},evening:{active:false,startTime:"14:00",totalHours:2,leaders:{},scheduleOverrides:{}}};
      await saveDateToDb(dk,{active:true,leaders:{sessions}});
    }
  };

  const toggleSession=async(dk,sessionId)=>{
    const sessions={...getDateSessions(dk)};
    sessions[sessionId]={...sessions[sessionId],active:!sessions[sessionId].active};
    await saveDateToDb(dk,{leaders:{sessions},active:true});
  };

  const updateSessionField=async(dk,sessionId,field,val)=>{
    const sessions={...getDateSessions(dk)};
    sessions[sessionId]={...sessions[sessionId],[field]:val};
    await saveDateToDb(dk,{leaders:{sessions}});
  };

  const toggleLocation=async(dk,locIdx)=>{
    const locs=[...(serviceDates[dk]?.activeLocations||[true,false,false,false,false])];
    locs[locIdx]=!locs[locIdx];
    await saveDateToDb(dk,{active_locations:locs});
  };

  const deleteDateFully=async(dk)=>{
    await supabase.from("registrations").delete().eq("date_key",dk);
    await supabase.from("service_dates").delete().eq("date_key",dk);
    if(selectedDate===dk){setSelectedDate(null);setSelectedSession(null);setAppTab("calendar");}
    await loadAll();
  };

  const getActiveLocIndices=(dk)=>{
    const locs=serviceDates[dk]?.activeLocations||[true,false,false,false,false];
    return locs.map((on,i)=>on?i:null).filter(i=>i!==null);
  };

  // ── 취소 ────────────────────────────────────────────────────────────
  const confirmCancel=async()=>{
    const reason=cancelReason==="기타"?(cancelCustom.trim()||"기타"):cancelReason;
    await supabase.from("service_dates").update({cancelled:true,cancel_reason:reason}).eq("date_key",cancelModal.dk);
    await loadAll();
    const text=buildCancelSms(cancelModal.dk,reason,Object.values(registrations[cancelModal.dk]||{}).reduce((a,s)=>({...a,...s}),{}));
    setCancelModal(null);setSmsModal({type:"cancel",dk:cancelModal.dk,text});
  };
  const undoCancel=async(dk)=>{await supabase.from("service_dates").update({cancelled:false,cancel_reason:""}).eq("date_key",dk);await loadAll();};

  const isDeadlinePassed=(dk,sessionId)=>{
    const sessions=getDateSessions(dk);
    const s=sessions[sessionId];
    if(!s)return false;
    return getDeadlineInfo(dk,s.startTime)?.expired??false;
  };

  // ── 신청 ────────────────────────────────────────────────────────────
  const register=async(dk,sessionId,locIdx)=>{
    if(isDeadlinePassed(dk,sessionId))return;
    const name=currentUser.name;
    const regs=(registrations[dk]?.[sessionId]?.[locIdx]||[]);
    if(regs.includes(name)||regs.length>=8)return;
    await supabase.from("registrations").insert({date_key:dk,loc_idx:locIdx,member_name:name,session_id:sessionId});
    await loadAll();
  };
  const unregister=async(dk,sessionId,locIdx)=>{
    if(isDeadlinePassed(dk,sessionId))return;
    await supabase.from("registrations").delete().eq("date_key",dk).eq("loc_idx",locIdx).eq("member_name",currentUser.name).eq("session_id",sessionId);
    await loadAll();
  };
  const adminRemove=async(dk,sessionId,locIdx,name)=>{
    await supabase.from("registrations").delete().eq("date_key",dk).eq("loc_idx",locIdx).eq("member_name",name).eq("session_id",sessionId);
    await loadAll();
  };

  // ── 인도자 ──────────────────────────────────────────────────────────
  const setLeader=async(dk,sessionId,locIdx,name)=>{
    const sessions={...getDateSessions(dk)};
    const cur=sessions[sessionId]?.leaders||{};
    sessions[sessionId]={...sessions[sessionId],leaders:{...cur,[locIdx]:cur[locIdx]===name?null:name}};
    await saveDateToDb(dk,{leaders:{sessions}});
  };

  // ── 시간표 ──────────────────────────────────────────────────────────
  const getSlots=(dk,sessionId,locIdx)=>{
    const sessions=getDateSessions(dk);
    const s=sessions[sessionId];
    if(!s)return[];
    const ov=s.scheduleOverrides?.[locIdx];
    if(ov?.length>0)return ov;
    return buildSchedule(registrations[dk]?.[sessionId]?.[locIdx]||[],s.startTime,s.totalHours??2);
  };
  const updateSlot=async(dk,sessionId,locIdx,si,field,val)=>{
    const sessions={...getDateSessions(dk)};
    const s=sessions[sessionId];
    const auto=buildSchedule(registrations[dk]?.[sessionId]?.[locIdx]||[],s.startTime,s.totalHours??2);
    const cur=(s.scheduleOverrides?.[locIdx]?.length>0)?s.scheduleOverrides[locIdx]:auto;
    const updated=cur.map((sl,i)=>i===si?{...sl,[field]:val}:sl);
    sessions[sessionId]={...s,scheduleOverrides:{...s.scheduleOverrides,[locIdx]:updated}};
    await saveDateToDb(dk,{leaders:{sessions}});
  };
  const resetSchedule=async(dk,sessionId,locIdx)=>{
    const sessions={...getDateSessions(dk)};
    const s=sessions[sessionId];
    const ov={...s.scheduleOverrides}; delete ov[locIdx];
    sessions[sessionId]={...s,scheduleOverrides:ov};
    await saveDateToDb(dk,{leaders:{sessions}});
  };

  // ── 회원 ────────────────────────────────────────────────────────────
  const addMember=async()=>{
    const name=nm.trim();if(!name||members.find(m=>m.name===name))return;
    await supabase.from("members").insert({name,phone:nph.trim(),gender:ngen,is_admin:nadm,is_leader:nldr});
    await loadAll();setNm("");setNph("");setNgen("형제");setNadm(false);setNldr(false);
  };
  const removeMember=async(name)=>{if(name==="관리자")return;await supabase.from("members").delete().eq("name",name);await loadAll();};
  const toggleMemberAdmin=async(name)=>{if(name==="관리자")return;const m=members.find(x=>x.name===name);if(!m)return;await supabase.from("members").update({is_admin:!m.isAdmin}).eq("name",name);await loadAll();};
  const toggleMemberLeader=async(name)=>{if(name==="관리자")return;const m=members.find(x=>x.name===name);if(!m)return;await supabase.from("members").update({is_leader:!m.isLeader}).eq("name",name);await loadAll();};
  const savePhone=async(name)=>{await supabase.from("members").update({phone:editPhoneVal}).eq("name",name);await loadAll();setEditPhoneIdx(null);};

  const startEditLoc=i=>{setEditingLocIdx(i);setEditingLocName(locationNames[i]);};
  const saveLocName=async()=>{
    if(!editingLocName.trim())return;
    const next=[...locationNames];next[editingLocIdx]=editingLocName.trim();
    await supabase.from("settings").upsert({key:"location_names",value:next});
    await loadAll();setEditingLocIdx(null);
  };

  // ── SMS ─────────────────────────────────────────────────────────────
  const openScheduleSms=(dk,sessionId,locIdx)=>{
    const sessions=getDateSessions(dk);const s=sessions[sessionId];
    const sessLabel=SESSION_TYPES.find(t=>t.id===sessionId)?.label||"";
    setSmsModal({type:"schedule",dk,sessionId,locIdx,text:buildScheduleSms(dk,locationNames[locIdx],getSlots(dk,sessionId,locIdx),s.startTime,s.totalHours??2,sessLabel)});
  };
  const sendSms=()=>{
    let nums=[];
    if(smsModal.type==="schedule"||smsModal.type==="leader")
      nums=(registrations[smsModal.dk]?.[smsModal.sessionId]?.[smsModal.locIdx]||[]).filter(n=>smsModal.type==="leader"?n!==currentUser?.name:true).map(n=>members.find(m=>m.name===n)?.phone).filter(Boolean);
    else nums=[...new Set(Object.values(Object.values(registrations[smsModal.dk]||{}).reduce((a,s)=>({...a,...s}),{})).flat())].map(n=>members.find(m=>m.name===n)?.phone).filter(Boolean);
    if(nums.length)window.location.href=`sms:${nums.join(",")}?body=${encodeURIComponent(smsModal.text)}`;
    else navigator.clipboard?.writeText(smsModal.text).then(()=>alert("클립보드에 복사되었습니다."));
  };

  const hasBrother=(dk,sessionId,locIdx)=>(registrations[dk]?.[sessionId]?.[locIdx]||[]).some(name=>members.find(m=>m.name===name)?.gender==="형제");

  // 달력에서 해당 날짜에 내가 신청한 세션이 있는지
  const mySessionsOnDate=(dk)=>{
    if(!currentUser)return[];
    const result=[];
    ["morning","evening"].forEach(sid=>{
      if(Object.values(registrations[dk]?.[sid]||{}).some(arr=>arr.includes(currentUser.name)))
        result.push(sid);
    });
    return result;
  };

  // 해당 날짜의 활성 세션 목록
  const getActiveSessions=(dk)=>{
    const sessions=getDateSessions(dk);
    return SESSION_TYPES.filter(t=>sessions[t.id]?.active);
  };

  // ── 공지사항 ──────────────────────────────────────────────────────
  const saveNotices=async(list)=>{
    await supabase.from("settings").upsert({key:"notices",value:list});
    await loadAll();
  };
  const addNotice=async()=>{
    if(!noticeTitle.trim())return;
    const newN={id:Date.now().toString(),title:noticeTitle.trim(),content:noticeContent.trim(),pinned:noticePinned,createdAt:new Date().toISOString()};
    await saveNotices([newN,...notices]);
    setNoticeModal(null);setNoticeTitle("");setNoticeContent("");setNoticePinned(false);
  };
  const updateNotice=async(id)=>{
    if(!noticeTitle.trim())return;
    await saveNotices(notices.map(n=>n.id===id?{...n,title:noticeTitle.trim(),content:noticeContent.trim(),pinned:noticePinned}:n));
    setNoticeModal(null);setNoticeTitle("");setNoticeContent("");setNoticePinned(false);
  };
  const deleteNotice=async(id)=>{
    if(!window.confirm("공지사항을 삭제할까요?"))return;
    await saveNotices(notices.filter(n=>n.id!==id));
  };
  const sortedNotices=[...notices.filter(n=>n.pinned),...notices.filter(n=>!n.pinned)];

  if(loading) return (
    <div style={{...S.page,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
      <div style={{fontSize:56,marginBottom:12}}>📋</div>
      <h1 style={{fontSize:24,fontWeight:900,color:"#1e3a8a",marginBottom:4}}>전시대 봉사 신청</h1>
      <Spinner/>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════
  //  로그인 화면
  // ══════════════════════════════════════════════════════════════════
  if(screen==="login") return (
    <div style={S.page}>
      <div style={S.loginWrap}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:64,marginBottom:8}}>📋</div>
          <h1 style={{fontWeight:900,fontSize:28,color:"#1e3a8a",margin:"0 0 4px"}}>전시대 봉사 신청</h1>
          <p style={{color:"#3b82f6",fontSize:14,margin:0,fontWeight:600}}>Exhibition Booth Volunteer</p>
        </div>

        <div style={S.modeRow}>
          {[{key:"member",icon:"👤",label:"참여자 접속",sub:"이름으로 로그인"},{key:"admin",icon:"🔑",label:"관리자 접속",sub:"비밀번호 입력"}].map(({key,icon,label,sub})=>(
            <button key={key} onClick={()=>{setLoginMode(key);setLoginError("");}}
              style={{...S.modeBtn,...(loginMode===key?S.modeBtnOn:{})}}>
              <span style={{fontSize:32,display:"block",marginBottom:6}}>{icon}</span>
              <span style={{fontWeight:800,fontSize:16,display:"block",color:loginMode===key?"#1e3a8a":"#374151"}}>{label}</span>
              <span style={{fontSize:12,color:loginMode===key?"#3b82f6":"#6b7280",display:"block",marginTop:2}}>{sub}</span>
            </button>
          ))}
        </div>

        <div style={S.loginCard}>
          {loginMode==="member"
            ?<><label style={S.label}>이름 입력</label>
              <input style={S.input} placeholder="등록된 이름을 입력하세요" value={loginInput}
                onChange={e=>{setLoginInput(e.target.value);setLoginError("");}}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/>
              <p style={{fontSize:13,color:"#6b7280",marginTop:6}}>💡 관리자가 등록한 이름만 접속 가능합니다</p></>
            :<><label style={S.label}>관리자 비밀번호</label>
              <input type="password" style={S.input} placeholder="비밀번호를 입력하세요" value={adminPwInput}
                onChange={e=>{setAdminPwInput(e.target.value);setLoginError("");}}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()} autoFocus/></>
          }
          {loginError&&<div style={{color:"#dc2626",fontSize:14,marginTop:8,fontWeight:600}}>{loginError}</div>}
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
    ...(selectedDate&&selData?.active&&selectedSession?[{id:"detail",label:"📍 신청현황"},...(isAdmin?[{id:"schedule",label:"⏱ 시간표"}]:[])]:[]),
    ...(isAdmin?[{id:"admin",label:"⚙️ 관리"}]:[]),
  ];

  return (
    <div style={S.page}>
      {/* SMS 모달 */}
      {smsModal&&(
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:17,marginBottom:4,color:"#1e3a8a"}}>{smsModal.type==="cancel"?"❌ 취소 안내 문자":smsModal.type==="leader"?"👑 인도자 안내 문자":"📱 시간표 문자 발송"}</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:14}}>{fmt(smsModal.dk)}{smsModal.locIdx!=null?" · "+locationNames[smsModal.locIdx]:""}</div>
            <div style={{fontSize:13,color:"#3b82f6",fontWeight:700,marginBottom:8}}>수신자</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
              {(()=>{
                let names=smsModal.type==="schedule"?registrations[smsModal.dk]?.[smsModal.sessionId]?.[smsModal.locIdx]||[]:smsModal.type==="leader"?(registrations[smsModal.dk]?.[smsModal.sessionId]?.[smsModal.locIdx]||[]).filter(n=>n!==currentUser?.name):[...new Set(Object.values(Object.values(registrations[smsModal.dk]||{}).reduce((a,s)=>({...a,...s}),{})).flat())];
                return names.map((name,i)=>{const mem=members.find(m=>m.name===name);return(
                  <div key={i} style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:20,padding:"4px 12px",fontSize:13,color:"#1e40af"}}>
                    {name} {mem?.phone?<span style={{color:"#3b82f6"}}>({mem.phone})</span>:<span style={{color:"#ef4444"}}>번호없음</span>}
                  </div>);});
              })()}
            </div>
            <textarea style={S.textarea} value={smsModal.text} onChange={e=>setSmsModal(p=>({...p,text:e.target.value}))}/>
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button onClick={()=>setSmsModal(null)} style={{...S.ghostBtn,flex:1,padding:"10px"}}>닫기</button>
              <button onClick={sendSms} style={{...S.primaryBtn,flex:2,padding:"10px"}}>📤 발송 / 복사</button>
            </div>
          </div>
        </div>
      )}

      {/* 공지사항 작성/수정 모달 */}
      {noticeModal&&(
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:17,marginBottom:16,color:"#1e3a8a"}}>
              {noticeModal.mode==="new"?"📢 공지사항 작성":"📢 공지사항 수정"}
            </div>
            <label style={{...S.label,marginBottom:6}}>제목</label>
            <input style={{...S.input,marginBottom:12}} placeholder="공지사항 제목" value={noticeTitle} onChange={e=>setNoticeTitle(e.target.value)}/>
            <label style={{...S.label,marginBottom:6}}>내용</label>
            <textarea style={{...S.textarea,height:140,marginBottom:12}} placeholder="공지사항 내용을 입력하세요" value={noticeContent} onChange={e=>setNoticeContent(e.target.value)}/>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:16,fontSize:14,fontWeight:600,color:"#374151"}}>
              <input type="checkbox" checked={noticePinned} onChange={e=>setNoticePinned(e.target.checked)} style={{width:16,height:16}}/>
              📌 상단 고정 (중요 공지)
            </label>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setNoticeModal(null);setNoticeTitle("");setNoticeContent("");setNoticePinned(false);}} style={{...S.ghostBtn,flex:1,padding:"10px"}}>취소</button>
              <button onClick={()=>noticeModal.mode==="new"?addNotice():updateNotice(noticeModal.notice.id)} style={{...S.primaryBtn,flex:2,padding:"10px"}}>
                {noticeModal.mode==="new"?"등록":"수정"}
              </button>
            </div>
          </div>
        </div>
      )}
      {cancelModal&&(
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:17,marginBottom:4,color:"#1e3a8a"}}>❌ 봉사 취소 처리</div>
            <div style={{fontSize:13,color:"#6b7280",marginBottom:16}}>{fmt(cancelModal.dk)}</div>
            <div style={{fontSize:13,color:"#3b82f6",fontWeight:700,marginBottom:10}}>취소 사유를 선택하세요</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
              {CANCEL_REASONS.map(r=>(
                <button key={r} onClick={()=>setCancelReason(r)}
                  style={{padding:"8px 14px",borderRadius:10,border:`2px solid ${cancelReason===r?"#3b82f6":"#e5e7eb"}`,background:cancelReason===r?"#eff6ff":"white",color:cancelReason===r?"#1d4ed8":"#374151",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                  {r}
                </button>
              ))}
            </div>
            {cancelReason==="기타"&&<input style={{...S.input,marginBottom:12}} placeholder="직접 입력..." value={cancelCustom} onChange={e=>setCancelCustom(e.target.value)}/>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setCancelModal(null)} style={{...S.ghostBtn,flex:1,padding:"12px"}}>닫기</button>
              <button onClick={confirmCancel} style={{background:"linear-gradient(90deg,#dc2626,#ef4444)",border:"none",borderRadius:10,color:"#fff",padding:"12px",flex:2,fontWeight:800,fontSize:15,cursor:"pointer"}}>취소 처리 및 문자 발송</button>
            </div>
          </div>
        </div>
      )}

      {/* 헤더 */}
      <header style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:28}}>📋</span>
          <div>
            <div style={{fontWeight:900,fontSize:17,color:"#1e3a8a"}}>전시대 봉사</div>
            <div style={{fontSize:11,color:"#3b82f6",fontWeight:600}}>Exhibition Booth</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:20,padding:"6px 14px",fontSize:14,fontWeight:700,color:"#1e40af",display:"flex",alignItems:"center",gap:6}}>
            {isAdmin?"🔑":"👤"} {currentUser?.name}
            {currentUser?.gender&&<GenderBadge gender={currentUser.gender}/>}
            {isAdmin&&<span style={{background:"#1d4ed8",color:"white",borderRadius:6,padding:"1px 6px",fontSize:11,fontWeight:800}}>관리자</span>}
          </div>
          <button onClick={logout} style={S.ghostBtn}>나가기</button>
        </div>
      </header>

      {/* 탭 */}
      <div style={{display:"flex",background:"white",borderBottom:"2px solid #bfdbfe",padding:"0 16px",overflowX:"auto"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setAppTab(t.id)}
            style={{padding:"14px 18px",border:"none",borderBottom:`3px solid ${appTab===t.id?"#2563eb":"transparent"}`,background:"transparent",color:appTab===t.id?"#1d4ed8":"#6b7280",fontSize:14,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>

      <main style={{maxWidth:780,margin:"0 auto",padding:"20px 16px"}}>

        {/* ══════════ 달력 ══════════════════════════════════════════ */}
        {appTab==="calendar"&&(
          <div>

            {/* 공지사항 섹션 */}
            <div style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontWeight:800,fontSize:16,color:"#1e3a8a",display:"flex",alignItems:"center",gap:6}}>
                  📢 공지사항
                </div>
                {isAdmin&&(
                  <button onClick={()=>{setNoticeModal({mode:"new"});setNoticeTitle("");setNoticeContent("");setNoticePinned(false);}}
                    style={{...S.primaryBtn,fontSize:12,padding:"6px 14px"}}>
                    + 공지 작성
                  </button>
                )}
              </div>
              {sortedNotices.length===0?(
                <div style={{background:"white",borderRadius:12,padding:"16px",border:"1px solid #e5e7eb",textAlign:"center",color:"#9ca3af",fontSize:14}}>
                  등록된 공지사항이 없습니다.
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {sortedNotices.map(n=>(
                    <div key={n.id} style={{background:n.pinned?"#fffbeb":"white",border:`1.5px solid ${n.pinned?"#fde68a":"#e5e7eb"}`,borderRadius:12,padding:"14px 16px",boxShadow:"0 1px 4px rgba(0,0,0,0.04)"}}>
                      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                            {n.pinned&&<span style={{fontSize:14}}>📌</span>}
                            <span style={{fontWeight:800,fontSize:15,color:"#1e3a8a"}}>{n.title}</span>
                          </div>
                          {n.content&&(
                            <div style={{fontSize:14,color:"#374151",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{n.content}</div>
                          )}
                          <div style={{fontSize:11,color:"#9ca3af",marginTop:6}}>
                            {new Date(n.createdAt).toLocaleDateString("ko-KR",{month:"long",day:"numeric"})}
                          </div>
                        </div>
                        {isAdmin&&(
                          <div style={{display:"flex",gap:4,flexShrink:0}}>
                            <button onClick={()=>{setNoticeModal({mode:"edit",notice:n});setNoticeTitle(n.title);setNoticeContent(n.content);setNoticePinned(n.pinned);}}
                              style={{background:"transparent",border:"1px solid #cbd5e1",borderRadius:6,color:"#6b7280",padding:"3px 8px",fontSize:12,cursor:"pointer"}}>✏️</button>
                            <button onClick={()=>deleteNotice(n.id)}
                              style={{background:"transparent",border:"1px solid #fca5a5",borderRadius:6,color:"#ef4444",padding:"3px 8px",fontSize:12,cursor:"pointer"}}>🗑</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <button style={S.arrowBtn} onClick={()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);}}>‹</button>
              <span style={{fontWeight:900,fontSize:22,color:"#1e3a8a"}}>{year}년 {MON_KO[month]}</span>
              <button style={S.arrowBtn} onClick={()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);}}>›</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6}}>
              {DAY_KO.map((d,i)=><div key={d} style={{textAlign:"center",fontSize:13,fontWeight:800,padding:"4px 0 8px",color:i===0?"#ef4444":i===6?"#2563eb":"#374151"}}>{d}</div>)}
              {Array.from({length:firstDow}).map((_,i)=><div key={`g${i}`}/>)}
              {Array.from({length:daysInMonth}).map((_,i)=>{
                const day=i+1,dk=dkOf(year,month,day),d=serviceDates[dk];
                const active=d?.active,cancelled=d?.cancelled;
                const isToday=dk===todayKey,isSel=dk===selectedDate;
                const dow=new Date(year,month,day).getDay();
                const holiday=KR_HOLIDAYS[dk];
                const activeSessions=active?getActiveSessions(dk):[];
                const mySessions=mySessionsOnDate(dk);
                const hasMorning=activeSessions.some(s=>s.id==="morning");
                const hasEvening=activeSessions.some(s=>s.id==="evening");
                const isFirstSat=dow===6&&day<=7;

                return (
                  <div key={dk}
                    onClick={()=>{if(active||isAdmin){setSelectedDate(dk);setSelectedSession(null);setAppTab("detail");}}}
                    style={{
                      borderRadius:12,padding:"6px 4px",display:"flex",flexDirection:"column",alignItems:"center",
                      background:isSel?"#2563eb":active?"#eff6ff":"white",
                      border:isToday?"2.5px solid #2563eb":cancelled?"1.5px solid #fca5a5":active?"1.5px solid #93c5fd":"1px solid #e5e7eb",
                      cursor:(active||isAdmin)?"pointer":"default",
                      opacity:!active&&!isAdmin?0.4:1,
                      minHeight:56,
                    }}>
                    <span style={{fontSize:15,fontWeight:isToday?900:600,color:isSel?"white":cancelled?"#ef4444":holiday?"#f59e0b":dow===0?"#ef4444":dow===6?"#2563eb":"#1f2937"}}>{day}</span>
                    {holiday&&!cancelled&&<div style={{fontSize:7,color:"#f59e0b",maxWidth:"90%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1,marginTop:1}}>{holiday}</div>}
                    {isFirstSat&&<div style={{fontSize:7,color:"#7c3aed",fontWeight:800,lineHeight:1,marginTop:1,whiteSpace:"nowrap"}}>집단봉사</div>}
                    {cancelled&&<div style={{fontSize:9,color:"#ef4444",fontWeight:800}}>취소</div>}
                    {/* 세션 표시 */}
                    {!cancelled&&active&&(
                      <div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap",justifyContent:"center"}}>
                        {hasMorning&&<div style={{
                          width:mySessions.includes("morning")?10:7,
                          height:mySessions.includes("morning")?10:7,
                          borderRadius:"50%",
                          background:mySessions.includes("morning")?"#16a34a":"#fde68a",
                          border:`2px solid ${mySessions.includes("morning")?"#15803d":"#f59e0b"}`,
                          boxShadow:mySessions.includes("morning")?"0 0 4px rgba(22,163,74,0.6)":"none",
                        }}/>}
                        {hasEvening&&<div style={{
                          width:mySessions.includes("evening")?10:7,
                          height:mySessions.includes("evening")?10:7,
                          borderRadius:"50%",
                          background:mySessions.includes("evening")?"#16a34a":"#c7d2fe",
                          border:`2px solid ${mySessions.includes("evening")?"#15803d":"#6366f1"}`,
                          boxShadow:mySessions.includes("evening")?"0 0 4px rgba(22,163,74,0.6)":"none",
                        }}/>}
                      </div>
                    )}
                    {isAdmin&&!cancelled&&(
                      <div onClick={e=>{e.stopPropagation();toggleDateActive(dk);}}
                        style={{fontSize:9,background:active?"#2563eb":"#e5e7eb",borderRadius:4,padding:"1px 4px",marginTop:2,cursor:"pointer",color:active?"white":"#374151",fontWeight:800}}>
                        {active?"ON":"+"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 범례 */}
            <div style={{display:"flex",gap:14,marginTop:14,flexWrap:"wrap",padding:"12px 0"}}>
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#374151"}}><div style={{width:12,height:12,borderRadius:3,background:"#eff6ff",border:"1.5px solid #93c5fd"}}/>봉사 날짜</div>
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#374151"}}><div style={{width:10,height:10,borderRadius:"50%",background:"#fde68a",border:"1.5px solid #f59e0b"}}/>🌅 오전</div>
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#374151"}}><div style={{width:10,height:10,borderRadius:"50%",background:"#c7d2fe",border:"1.5px solid #6366f1"}}/>🌆 오후/저녁</div>
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#374151"}}><div style={{width:12,height:12,borderRadius:"50%",background:"#16a34a",border:"2px solid #15803d",boxShadow:"0 0 4px rgba(22,163,74,0.5)"}}/>내가 신청한 날</div>
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#374151"}}><div style={{width:10,height:10,borderRadius:"50%",background:"#fca5a5",border:"1.5px solid #ef4444"}}/>취소</div>
            </div>

            {isAdmin&&<div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#1e40af"}}>💡 날짜 셀 하단 <b>+</b> 버튼으로 봉사 날짜를 활성화하세요.</div>}
          </div>
        )}

        {/* ══════════ 신청현황 ══════════════════════════════════════ */}
        {appTab==="detail"&&selectedDate&&(
          <div>
            {/* 날짜/요일 크게 표시 */}
            {(()=>{const {month:mo,day:d,dayKo,dowIdx}=fmtFull(selectedDate);
              return (
                <div style={{textAlign:"center",marginBottom:20,background:"white",borderRadius:16,padding:"20px",border:"2px solid #bfdbfe",boxShadow:"0 2px 8px rgba(37,99,235,0.08)"}}>
                  <div style={{fontSize:48,fontWeight:900,color:"#1e3a8a",lineHeight:1}}>{d}</div>
                  <div style={{fontSize:22,fontWeight:800,color:"#2563eb",marginTop:2}}>{mo}월 {dayKo}</div>
                  {selData?.cancelled&&<div style={{marginTop:8,background:"#fee2e2",borderRadius:20,padding:"4px 16px",fontSize:14,color:"#dc2626",fontWeight:700,display:"inline-block"}}>❌ 취소됨 — {selData.cancelReason}</div>}
                </div>
              );
            })()}

            {/* 세션 없으면 선택 먼저 */}
            {!selectedSession&&selData?.active&&!selData?.cancelled&&(()=>{
              const activeSessions=getActiveSessions(selectedDate);
              if(activeSessions.length===0) return (
                <div>
                  <div style={{textAlign:"center",color:"#6b7280",padding:"24px 0",fontSize:16}}>
                    활성화된 세션이 없습니다.
                  </div>
                  {isAdmin&&(
                    <AdminDateSettings dk={selectedDate} selData={selData} getDateSessions={getDateSessions} toggleSession={toggleSession} updateSessionField={updateSessionField} toggleLocation={toggleLocation} locationNames={locationNames} setCancelModal={setCancelModal} deleteDateFully={deleteDateFully} toggleDateActive={toggleDateActive} setAppTab={setAppTab}/>
                  )}
                </div>
              );
              return (
                <div>
                  <div style={{textAlign:"center",fontSize:18,fontWeight:800,color:"#1e3a8a",marginBottom:16}}>참여할 봉사를 선택하세요</div>
                  <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
                    {activeSessions.map(sess=>{
                      const sessData=getDateSessions(selectedDate)[sess.id];
                      const myRegged=Object.values(registrations[selectedDate]?.[sess.id]||{}).some(arr=>arr.includes(currentUser?.name));
                      return (
                        <button key={sess.id} onClick={()=>setSelectedSession(sess.id)}
                          style={{background:myRegged?"#eff6ff":"white",border:`2.5px solid ${myRegged?"#2563eb":"#d1d5db"}`,borderRadius:20,padding:"20px 32px",cursor:"pointer",textAlign:"center",minWidth:140,boxShadow:myRegged?"0 4px 12px rgba(37,99,235,0.15)":"none"}}>
                          <div style={{fontSize:32,marginBottom:8}}>{sess.id==="morning"?"🌅":"🌆"}</div>
                          <div style={{fontWeight:900,fontSize:18,color:"#1e3a8a"}}>{sess.label}</div>
                          <div style={{fontSize:13,color:"#6b7280",marginTop:4}}>{sessData?.startTime} 시작</div>
                          {myRegged&&<div style={{marginTop:8,background:"#2563eb",color:"white",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700}}>신청됨 ✓</div>}
                        </button>
                      );
                    })}
                  </div>
                  {isAdmin&&(
                    <div style={{marginTop:20}}>
                      <AdminDateSettings dk={selectedDate} selData={selData} getDateSessions={getDateSessions} toggleSession={toggleSession} updateSessionField={updateSessionField} toggleLocation={toggleLocation} locationNames={locationNames} setCancelModal={setCancelModal} deleteDateFully={deleteDateFully} toggleDateActive={toggleDateActive} setAppTab={setAppTab}/>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 세션 선택됨 */}
            {selectedSession&&selData?.active&&!selData?.cancelled&&(()=>{
              const sessions=getDateSessions(selectedDate);
              const sessData=sessions[selectedSession];
              const sessLabel=SESSION_TYPES.find(t=>t.id===selectedSession)?.label||"";
              const sessColor=SESSION_TYPES.find(t=>t.id===selectedSession)?.color||"#2563eb";
              if(!sessData?.active) return (
                <div>
                  <button onClick={()=>setSelectedSession(null)} style={{...S.ghostBtn,marginBottom:16}}>← 세션 선택으로</button>
                  <div style={{textAlign:"center",color:"#6b7280",padding:"32px 0",fontSize:16}}>이 세션은 활성화되지 않았습니다.</div>
                </div>
              );
              return (
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                    <button onClick={()=>setSelectedSession(null)} style={S.ghostBtn}>← 뒤로</button>
                    <div style={{background:sessColor,color:"white",borderRadius:20,padding:"6px 18px",fontWeight:800,fontSize:16}}>{sessLabel}</div>
                    <span style={{fontSize:15,color:"#374151",fontWeight:600}}>{sessData.startTime} 시작 · {sessData.totalHours||2}시간</span>
                  </div>

                  {isAdmin&&(
                    <AdminDateSettings dk={selectedDate} selData={selData} sessionId={selectedSession} sessData={sessData} getDateSessions={getDateSessions} toggleSession={toggleSession} updateSessionField={updateSessionField} toggleLocation={toggleLocation} locationNames={locationNames} setCancelModal={setCancelModal} deleteDateFully={deleteDateFully} toggleDateActive={toggleDateActive} setAppTab={setAppTab}/>
                  )}

                  {getActiveLocIndices(selectedDate).length===0
                    ?<div style={{textAlign:"center",color:"#6b7280",padding:"32px 0"}}>활성화된 전시대가 없습니다.</div>
                    :getActiveLocIndices(selectedDate).map(locIdx=>{
                      const regs=selRegs[selectedSession]?.[locIdx]||[];
                      const isFull=regs.length>=8,meetsMin=regs.length>=4;
                      const myReg=regs.includes(currentUser?.name);
                      const dlPassed=isDeadlinePassed(selectedDate,selectedSession);
                      const locLeader=sessData?.leaders?.[locIdx];
                      const locLeaderMem=locLeader?members.find(m=>m.name===locLeader):null;
                      const hasBro=hasBrother(selectedDate,selectedSession,locIdx);
                      return (
                        <div key={locIdx} style={{background:"white",border:`2px solid ${hasBro?"#bfdbfe":"#fde68a"}`,borderRadius:16,padding:20,marginBottom:14,boxShadow:"0 2px 8px rgba(37,99,235,0.06)"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                              <span style={{fontWeight:900,fontSize:20,color:"#1e3a8a"}}>📍 {locationNames[locIdx]}</span>
                              <span style={{fontSize:14,fontWeight:700,padding:"3px 10px",borderRadius:20,border:"1.5px solid",color:isFull?"#dc2626":meetsMin?"#15803d":"#d97706",borderColor:isFull?"#fca5a5":meetsMin?"#86efac":"#fde68a",background:isFull?"#fee2e2":meetsMin?"#f0fdf4":"#fefce8"}}>
                                {regs.length}/8명 {isFull?"마감":meetsMin?"✓ 가능":"미달"}
                              </span>
                              {!hasBro&&regs.length>0&&<span style={{fontSize:12,color:"#d97706",background:"#fefce8",border:"1px solid #fde68a",borderRadius:10,padding:"2px 8px"}}>⚠️ 형제 필요</span>}
                            </div>
                            {!isAdmin&&(dlPassed
                              ?<span style={{fontSize:14,color:"#9ca3af",fontWeight:600}}>신청 마감</span>
                              :myReg
                                ?<button onClick={()=>unregister(selectedDate,selectedSession,locIdx)} style={{background:"#fee2e2",border:"1.5px solid #fca5a5",borderRadius:10,color:"#dc2626",padding:"10px 18px",fontWeight:800,fontSize:15,cursor:"pointer"}}>취소</button>
                                :<button onClick={()=>register(selectedDate,selectedSession,locIdx)} disabled={isFull} style={{...S.primaryBtn,opacity:isFull?0.4:1,fontSize:15,padding:"10px 20px"}}>
                                  {isFull?"마감":"신청하기"}
                                </button>
                            )}
                          </div>

                          {locLeaderMem&&(
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:10,padding:"10px 14px",flexWrap:"wrap"}}>
                              <span style={{fontSize:15,fontWeight:800,color:"#92400e"}}>👑 인도자</span>
                              <span style={{fontWeight:800,fontSize:16,color:"#1f2937"}}>{locLeaderMem.name}</span>
                              <GenderBadge gender={locLeaderMem.gender}/>
                              {locLeaderMem.phone&&<span style={{fontSize:13,color:"#2563eb",fontWeight:600}}>📱 {locLeaderMem.phone}</span>}
                              {currentUser?.name===locLeaderMem.name&&regs.length>=2&&(
                                <button onClick={()=>{const s=sessions[selectedSession];setSmsModal({type:"leader",dk:selectedDate,sessionId:selectedSession,locIdx,text:buildLeaderNoticeSms(selectedDate,locationNames[locIdx],regs,s.startTime,s.totalHours??2,currentUser.name,sessLabel)});}}
                                  style={{marginLeft:"auto",background:"#f59e0b",border:"none",borderRadius:8,color:"white",padding:"6px 14px",fontWeight:800,fontSize:13,cursor:"pointer"}}>
                                  📢 단체 안내 문자
                                </button>
                              )}
                            </div>
                          )}
                          {!locLeaderMem&&isAdmin&&<div style={{fontSize:13,color:"#d97706",marginBottom:8}}>👑 인도자 미지정</div>}

                          {/* 참가자 목록 */}
                          <div style={{display:"flex",flexWrap:"wrap",gap:8,margin:"10px 0"}}>
                            {regs.length===0&&<span style={{color:"#9ca3af",fontSize:15}}>아직 신청자가 없습니다</span>}
                            {regs.map((name,ni)=>{
                              const mem=members.find(m=>m.name===name);
                              const isMe=name===currentUser?.name;
                              const isLdr=sessData?.leaders?.[locIdx]===name;
                              return(
                                <div key={ni} style={{background:isMe?"#eff6ff":"#f9fafb",border:`2px solid ${isMe?"#2563eb":"#e5e7eb"}`,borderRadius:20,padding:"6px 14px",fontSize:15,fontWeight:isMe?800:600,display:"flex",alignItems:"center",gap:6,color:isMe?"#1d4ed8":"#1f2937"}}>
                                  {isMe&&<span>⭐</span>}{name}
                                  {mem?.gender&&<GenderBadge gender={mem.gender}/>}
                                  {isLdr&&<LeaderBadge/>}
                                  {isAdmin&&(
                                    <>
                                      <button onClick={()=>setLeader(selectedDate,selectedSession,locIdx,name)} title="인도자" style={{background:"transparent",border:"none",cursor:"pointer",fontSize:14,color:isLdr?"#f59e0b":"#9ca3af",padding:"0 2px"}}>👑</button>
                                      <span onClick={()=>adminRemove(selectedDate,selectedSession,locIdx,name)} style={{color:"#ef4444",fontSize:12,cursor:"pointer",fontWeight:900}}>✕</span>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {regs.length>=2&&(
                            <div style={{background:"#f0f9ff",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#374151",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                              <span>⏰ {Math.ceil(regs.length/2)}팀 · {Math.floor(60/Math.ceil(regs.length/2))}분 인터벌 · {sessData.totalHours||2}시간</span>
                              {isAdmin&&<div style={{display:"flex",gap:8}}>
                                <button onClick={()=>setAppTab("schedule")} style={{background:"transparent",border:"none",color:"#2563eb",fontSize:13,cursor:"pointer",fontWeight:700}}>시간표 →</button>
                                <button onClick={()=>openScheduleSms(selectedDate,selectedSession,locIdx)} style={{background:"transparent",border:"none",color:"#059669",fontSize:13,cursor:"pointer",fontWeight:700}}>📱 문자</button>
                              </div>}
                            </div>
                          )}
                        </div>
                      );
                    })
                  }
                </div>
              );
            })()}

            {selData?.cancelled&&(
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <div style={{fontSize:48,marginBottom:12}}>❌</div>
                <div style={{fontWeight:800,fontSize:18,color:"#dc2626"}}>봉사가 취소되었습니다</div>
                <div style={{color:"#6b7280",fontSize:15,marginTop:4}}>사유: {selData.cancelReason}</div>
                {isAdmin&&<div style={{display:"flex",gap:8,justifyContent:"center",marginTop:16}}>
                  <button onClick={()=>undoCancel(selectedDate)} style={{...S.ghostBtn,color:"#16a34a",borderColor:"#86efac"}}>복원</button>
                  <button onClick={()=>{const text=buildCancelSms(selectedDate,selData.cancelReason,Object.values(registrations[selectedDate]||{}).reduce((a,s)=>({...a,...s}),{}));setSmsModal({type:"cancel",dk:selectedDate,text});}} style={S.ghostBtn}>📱 재발송</button>
                </div>}
              </div>
            )}

            {!selData?.active&&isAdmin&&(
              <div>
                <div style={{textAlign:"center",color:"#6b7280",padding:"16px 0",fontSize:15}}>날짜를 활성화하고 세션을 설정하세요.</div>
                <AdminDateSettings dk={selectedDate} selData={selData||{activeLocations:[true,false,false,false,false]}} getDateSessions={getDateSessions} toggleSession={toggleSession} updateSessionField={updateSessionField} toggleLocation={toggleLocation} locationNames={locationNames} setCancelModal={setCancelModal} deleteDateFully={deleteDateFully} toggleDateActive={toggleDateActive} setAppTab={setAppTab}/>
              </div>
            )}
            {!selData?.active&&!isAdmin&&(
              <div style={{textAlign:"center",color:"#6b7280",padding:"32px 0",fontSize:16}}>봉사 일정이 없습니다.</div>
            )}
          </div>
        )}

        {/* ══════════ 시간표 (관리자) ═══════════════════════════════ */}
        {appTab==="schedule"&&selectedDate&&selData?.active&&isAdmin&&selectedSession&&(()=>{
          const sessions=getDateSessions(selectedDate);
          const sessData=sessions[selectedSession];
          const sessLabel=SESSION_TYPES.find(t=>t.id===selectedSession)?.label||"";
          return (
            <div>
              <div style={{marginBottom:20}}>
                <div style={{fontWeight:900,fontSize:22,color:"#1e3a8a"}}>⏱ 시간표</div>
                <div style={{fontSize:15,color:"#374151",marginTop:4}}>{fmt(selectedDate)} · {sessLabel} · {sessData?.totalHours||2}시간</div>
              </div>
              {getActiveLocIndices(selectedDate).map(locIdx=>{
                const regs=selRegs[selectedSession]?.[locIdx]||[];
                const slots=getSlots(selectedDate,selectedSession,locIdx);
                const hasOv=(sessData?.scheduleOverrides?.[locIdx]?.length>0);
                const locLeader=sessData?.leaders?.[locIdx];
                const locLeaderMem=locLeader?members.find(m=>m.name===locLeader):null;
                return (
                  <div key={locIdx} style={{background:"white",border:"1.5px solid #bfdbfe",borderRadius:16,padding:20,marginBottom:16}}>
                    <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:12,paddingBottom:10,borderBottom:"1px solid #e5e7eb"}}>
                      {editingLocIdx===locIdx?(
                        <div style={{display:"flex",gap:8,alignItems:"center",flex:1}}>
                          <input style={{...S.input,flex:1,fontSize:15,fontWeight:700}} value={editingLocName} onChange={e=>setEditingLocName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveLocName();if(e.key==="Escape")setEditingLocIdx(null);}} autoFocus/>
                          <button onClick={saveLocName} style={S.primaryBtn}>저장</button>
                          <button onClick={()=>setEditingLocIdx(null)} style={S.ghostBtn}>취소</button>
                        </div>
                      ):(
                        <>
                          <span style={{fontWeight:900,fontSize:18,color:"#1e3a8a"}}>📍 {locationNames[locIdx]}</span>
                          <button onClick={()=>startEditLoc(locIdx)} style={{...S.ghostBtn,fontSize:11,padding:"2px 8px"}}>✏️ 이름</button>
                          <span style={{fontSize:13,color:"#6b7280"}}>{regs.length}명</span>
                          {hasOv&&<button onClick={()=>resetSchedule(selectedDate,selectedSession,locIdx)} style={{background:"transparent",border:"none",color:"#ef4444",fontSize:13,cursor:"pointer",fontWeight:700}}>초기화</button>}
                          {regs.length>=2&&<button onClick={()=>openScheduleSms(selectedDate,selectedSession,locIdx)} style={{background:"transparent",border:"none",color:"#059669",fontSize:13,cursor:"pointer",fontWeight:700}}>📱 문자</button>}
                        </>
                      )}
                    </div>
                    {locLeaderMem&&(
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:10,padding:"10px 14px"}}>
                        <span style={{fontSize:18}}>👑</span>
                        <span style={{fontWeight:800,fontSize:16}}>{locLeaderMem.name}</span>
                        <GenderBadge gender={locLeaderMem.gender}/>
                        {locLeaderMem.phone&&<span style={{fontSize:14,color:"#2563eb",fontWeight:600}}>📱 {locLeaderMem.phone}</span>}
                      </div>
                    )}
                    {regs.length<2
                      ?<div style={{textAlign:"center",color:"#9ca3af",padding:"20px 0",fontSize:14}}>2명 이상 신청 시 시간표가 생성됩니다.</div>
                      :(
                        <>
                          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
                            {regs.map((name,i)=>{const mem=members.find(m=>m.name===name);const cnt=slots.filter(s=>s.pair.includes(name)).length;const isLdr=sessData?.leaders?.[locIdx]===name;
                              return(<div key={i} style={{background:"#f1f5f9",borderRadius:20,padding:"4px 12px",fontSize:13,border:"1px solid #e2e8f0",display:"flex",alignItems:"center",gap:4}}>
                                {isLdr&&<span style={{color:"#f59e0b"}}>👑</span>}{name}{mem?.gender&&<GenderBadge gender={mem.gender}/>}<span style={{background:"#e2e8f0",borderRadius:10,padding:"1px 6px",fontSize:11,color:"#64748b"}}>{cnt}회</span>
                              </div>);
                            })}
                          </div>
                          {slots.map((slot,si)=>{
                            const showDiv=si>0&&slot.cycle!==slots[si-1].cycle;
                            return(<div key={si}>
                              {showDiv&&<div style={{display:"flex",alignItems:"center",gap:8,margin:"10px 0 6px"}}><div style={{flex:1,height:1,background:"#bfdbfe"}}/><span style={{fontSize:12,color:"#2563eb",fontWeight:700}}>{slot.cycle}시간차</span><div style={{flex:1,height:1,background:"#bfdbfe"}}/></div>}
                              <div style={{display:"flex",alignItems:"flex-start",gap:12,borderRadius:10,padding:"10px 14px",marginBottom:4,background:si%2===0?"#f8fafc":"white",border:"1px solid #e2e8f0"}}>
                                <div style={{minWidth:26,height:26,borderRadius:"50%",background:"#2563eb",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"white",flexShrink:0}}>{si+1}</div>
                                <div style={{flex:1}}>
                                  <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
                                    <input type="time" value={slot.start} onChange={e=>updateSlot(selectedDate,selectedSession,locIdx,si,"start",e.target.value)} style={{background:"#f1f5f9",border:"1px solid #cbd5e1",borderRadius:6,color:"#1f2937",padding:"3px 6px",fontSize:13}}/>
                                    <span style={{color:"#6b7280"}}>~</span>
                                    <input type="time" value={slot.end} onChange={e=>updateSlot(selectedDate,selectedSession,locIdx,si,"end",e.target.value)} style={{background:"#f1f5f9",border:"1px solid #cbd5e1",borderRadius:6,color:"#1f2937",padding:"3px 6px",fontSize:13}}/>
                                  </div>
                                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                                    {slot.pair.map((name,pi)=>{const mem=members.find(m=>m.name===name);const isLdr=sessData?.leaders?.[locIdx]===name;
                                      return(<span key={pi} style={{background:"#eff6ff",borderRadius:20,padding:"3px 10px",fontSize:13,display:"inline-flex",alignItems:"center",gap:4,color:"#1e40af",fontWeight:600}}>
                                        {isLdr&&<span style={{color:"#f59e0b"}}>👑</span>}{name}{mem?.gender&&<GenderBadge gender={mem.gender}/>}
                                      </span>);
                                    })}
                                  </div>
                                </div>
                              </div>
                            </div>);
                          })}
                        </>
                      )
                    }
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ══════════ 관리 탭 ══════════════════════════════════════ */}
        {appTab==="admin"&&isAdmin&&(
          <div>
            <div style={{fontWeight:900,fontSize:22,color:"#1e3a8a",marginBottom:20}}>⚙️ 회원 관리</div>

            {/* 전시대 이름 */}
            <div style={S.adminPanel}>
              <div style={S.aPanelTitle}>📍 전시대 이름 설정</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {locationNames.map((name,idx)=>(
                  <div key={idx} style={{display:"flex",alignItems:"center",gap:6,background:"#f8fafc",borderRadius:10,padding:"8px 12px",border:"1px solid #e2e8f0"}}>
                    {editingLocIdx===idx?(
                      <><input style={{...S.input,minWidth:120}} value={editingLocName} onChange={e=>setEditingLocName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveLocName();if(e.key==="Escape")setEditingLocIdx(null);}} autoFocus/>
                      <button onClick={saveLocName} style={{...S.primaryBtn,padding:"4px 10px",fontSize:12}}>저장</button>
                      <button onClick={()=>setEditingLocIdx(null)} style={{...S.ghostBtn,padding:"4px 8px"}}>✕</button></>
                    ):(<><span style={{fontWeight:700,fontSize:14,color:"#1f2937"}}>{idx+1}. {name}</span><button onClick={()=>startEditLoc(idx)} style={{...S.ghostBtn,padding:"3px 8px",fontSize:11}}>✏️</button></>)}
                  </div>
                ))}
              </div>
            </div>

            {/* 회원 추가 */}
            <div style={S.adminPanel}>
              <div style={S.aPanelTitle}>➕ 새 회원 추가</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:110}}><span style={{fontSize:12,color:"#6b7280",fontWeight:600}}>이름</span><input style={{...S.input,marginBottom:0}} placeholder="이름" value={nm} onChange={e=>setNm(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMember()}/></div>
                <div style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:120}}><span style={{fontSize:12,color:"#6b7280",fontWeight:600}}>전화번호</span><input style={{...S.input,marginBottom:0}} placeholder="010-xxxx-xxxx" value={nph} onChange={e=>setNph(e.target.value)}/></div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <span style={{fontSize:12,color:"#6b7280",fontWeight:600}}>성별</span>
                  <div style={{display:"flex",gap:4}}>
                    {["형제","자매"].map(g=><button key={g} onClick={()=>setNgen(g)} style={{height:42,padding:"0 14px",borderRadius:8,border:`2px solid ${ngen===g?(g==="형제"?"#2563eb":"#db2777"):"#e5e7eb"}`,background:ngen===g?(g==="형제"?"#eff6ff":"#fdf2f8"):"white",color:ngen===g?(g==="형제"?"#1d4ed8":"#be185d"):"#374151",fontWeight:700,fontSize:14,cursor:"pointer"}}>{g}</button>)}
                  </div>
                </div>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <label style={{display:"flex",alignItems:"center",gap:5,fontSize:13,color:"#374151",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"}}><input type="checkbox" checked={nldr} onChange={e=>setNldr(e.target.checked)}/>인도자</label>
                  <label style={{display:"flex",alignItems:"center",gap:5,fontSize:13,color:"#374151",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"}}><input type="checkbox" checked={nadm} onChange={e=>setNadm(e.target.checked)}/>관리자</label>
                  <button onClick={addMember} style={{...S.primaryBtn,height:42,padding:"0 20px"}}>추가</button>
                </div>
              </div>
            </div>

            {/* 회원 목록 */}
            <div style={{fontWeight:700,fontSize:14,color:"#374151",marginBottom:8}}>전체 회원 ({members.length}명) — 형제 {members.filter(m=>m.gender==="형제").length}명 · 자매 {members.filter(m=>m.gender==="자매").length}명</div>
            <div style={{background:"white",borderRadius:14,border:"1px solid #e5e7eb",overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
              {members.map((m,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:"1px solid #f1f5f9",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flex:1,minWidth:0}}>
                    <div style={{width:40,height:40,borderRadius:10,background:m.gender==="형제"?"linear-gradient(135deg,#3b82f6,#1d4ed8)":"linear-gradient(135deg,#ec4899,#9d174d)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:17,color:"white",flexShrink:0}}>{m.name[0]}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontWeight:700,fontSize:16,color:"#1f2937"}}>{m.name}</span>
                        {m.gender&&<GenderBadge gender={m.gender}/>}
                        {m.isLeader&&<LeaderBadge/>}
                        {m.isAdmin&&<span style={{background:"#1d4ed8",color:"white",borderRadius:6,padding:"1px 6px",fontSize:11,fontWeight:800}}>관리자</span>}
                      </div>
                      {editPhoneIdx===i?(
                        <div style={{display:"flex",gap:6,marginTop:4}}>
                          <input style={{...S.input,flex:1,fontSize:12}} value={editPhoneVal} onChange={e=>setEditPhoneVal(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")savePhone(m.name);}} placeholder="010-xxxx-xxxx" autoFocus/>
                          <button onClick={()=>savePhone(m.name)} style={{...S.primaryBtn,padding:"4px 10px",fontSize:12}}>저장</button>
                          <button onClick={()=>setEditPhoneIdx(null)} style={{...S.ghostBtn,padding:"4px 8px"}}>✕</button>
                        </div>
                      ):(
                        <div style={{fontSize:13,color:m.phone?"#2563eb":"#9ca3af",marginTop:2,cursor:"pointer",fontWeight:m.phone?600:400}} onClick={()=>{setEditPhoneIdx(i);setEditPhoneVal(m.phone||"");}}>
                          📱 {m.phone||"번호 추가"}
                        </div>
                      )}
                    </div>
                  </div>
                  {m.name!=="관리자"&&(
                    <div style={{display:"flex",gap:6,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      <button onClick={()=>toggleMemberLeader(m.name)} style={{...S.ghostBtn,color:m.isLeader?"#d97706":"#374151",borderColor:m.isLeader?"#fde68a":"#e5e7eb"}}>{m.isLeader?"인도자 ✓":"인도자"}</button>
                      <button onClick={()=>toggleMemberAdmin(m.name)} style={S.ghostBtn}>{m.isAdmin?"관리자 ✓":"관리자"}</button>
                      <button onClick={()=>removeMember(m.name)} style={{...S.ghostBtn,color:"#dc2626",borderColor:"#fca5a5"}}>삭제</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 봉사 일정 목록 */}
            <div style={{fontWeight:700,fontSize:14,color:"#374151",margin:"24px 0 8px"}}>봉사 일정</div>
            {Object.entries(serviceDates).filter(([,d])=>d.active).length===0
              ?<div style={{textAlign:"center",color:"#9ca3af",padding:"24px 0",fontSize:15}}>활성화된 봉사 날짜가 없습니다.</div>
              :Object.entries(serviceDates).filter(([,d])=>d.active).sort().map(([dk,d])=>{
                const sessions=d.sessions||{};
                const totalR=Object.values(registrations[dk]||{}).reduce((a,s)=>a+Object.values(s).reduce((b,arr)=>b+arr.length,0),0);
                const activeSessions=SESSION_TYPES.filter(t=>sessions[t.id]?.active);
                return (
                  <div key={dk} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"white",borderRadius:12,padding:"14px 16px",marginBottom:8,border:`1.5px solid ${d.cancelled?"#fca5a5":"#bfdbfe"}`,boxShadow:"0 1px 3px rgba(0,0,0,0.05)",gap:8,flexWrap:"wrap"}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontWeight:800,fontSize:16,color:"#1e3a8a"}}>{fmt(dk)}</span>
                        {d.cancelled&&<span style={{fontSize:12,color:"#dc2626",background:"#fee2e2",borderRadius:10,padding:"1px 8px",fontWeight:700}}>취소</span>}
                        {activeSessions.map(s=><span key={s.id} style={{fontSize:12,color:"white",background:s.color,borderRadius:10,padding:"1px 8px",fontWeight:700}}>{s.label}</span>)}
                      </div>
                      <div style={{fontSize:13,color:"#6b7280",marginTop:2}}>{totalR}명 신청{d.cancelled&&<span style={{color:"#dc2626"}}> · {d.cancelReason}</span>}</div>
                    </div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <button onClick={()=>{setSelectedDate(dk);setSelectedSession(null);setAppTab("detail");}} style={S.ghostBtn}>상세</button>
                      {!d.cancelled&&<button onClick={()=>setCancelModal({dk})} style={{...S.ghostBtn,color:"#dc2626",borderColor:"#fca5a5"}}>취소</button>}
                      {d.cancelled&&<button onClick={()=>undoCancel(dk)} style={{...S.ghostBtn,color:"#16a34a",borderColor:"#86efac"}}>복원</button>}
                      <button onClick={()=>deleteDateFully(dk)} style={{...S.ghostBtn,color:"#dc2626",borderColor:"#fca5a5"}}>삭제</button>
                    </div>
                  </div>
                );
              })
            }
          </div>
        )}
      </main>
    </div>
  );
}

// ── 관리자 날짜 설정 컴포넌트 ───────────────────────────────────────
function AdminDateSettings({dk,selData,sessionId,sessData,getDateSessions,toggleSession,updateSessionField,toggleLocation,locationNames,setCancelModal,deleteDateFully,toggleDateActive,setAppTab}) {
  const sessions=getDateSessions(dk);
  return (
    <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:14,padding:16,marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:13,color:"#1d4ed8",marginBottom:12}}>🔧 관리자 설정</div>

      {/* 세션 ON/OFF */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:13,color:"#374151",fontWeight:600,marginBottom:8}}>세션 활성화</div>
        <div style={{display:"flex",gap:10}}>
          {SESSION_TYPES.map(sess=>{
            const on=sessions[sess.id]?.active;
            return (
              <button key={sess.id} onClick={()=>toggleSession(dk,sess.id)}
                style={{padding:"8px 16px",borderRadius:10,border:`2px solid ${on?sess.color:"#e5e7eb"}`,background:on?`${sess.color}22`:"white",color:on?sess.color:"#374151",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                {sess.label} {on?"ON":"OFF"}
              </button>
            );
          })}
        </div>
      </div>

      {/* 세션별 시간 설정 */}
      {SESSION_TYPES.map(sess=>{
        const s=sessions[sess.id];
        if(!s?.active)return null;
        return (
          <div key={sess.id} style={{marginBottom:12,padding:"10px 12px",background:"white",borderRadius:10,border:`1px solid ${sess.color}44`}}>
            <div style={{fontWeight:700,fontSize:13,color:sess.color,marginBottom:8}}>{sess.label} 설정</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:13,color:"#374151"}}>시작</span>
                <input type="time" value={s.startTime} onChange={e=>updateSessionField(dk,sess.id,"startTime",e.target.value)}
                  style={{background:"#f8fafc",border:"1px solid #cbd5e1",borderRadius:8,color:"#1f2937",padding:"5px 8px",fontSize:13}}/>
              </div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                <span style={{fontSize:13,color:"#374151"}}>운영</span>
                {[1,2,3].map(n=><button key={n} onClick={()=>updateSessionField(dk,sess.id,"totalHours",n)}
                  style={{width:34,height:30,borderRadius:8,border:"1px solid #e5e7eb",background:(s.totalHours||2)===n?"#2563eb":"#f8fafc",color:(s.totalHours||2)===n?"white":"#374151",fontWeight:700,fontSize:13,cursor:"pointer"}}>{n}h</button>)}
              </div>
            </div>
          </div>
        );
      })}

      {/* 전시대 선택 */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:13,color:"#374151",fontWeight:600,marginBottom:8}}>전시대 선택</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {locationNames.map((locName,locIdx)=>{
            const on=(selData.activeLocations||[false,false,false,false,false])[locIdx];
            return(
              <button key={locIdx} onClick={()=>toggleLocation(dk,locIdx)}
                style={{padding:"6px 12px",borderRadius:8,border:`2px solid ${on?"#2563eb":"#e5e7eb"}`,background:on?"#eff6ff":"white",color:on?"#1d4ed8":"#374151",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {on?"✓ ":""}{locName}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button onClick={()=>setCancelModal({dk})} style={{background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:8,color:"#dc2626",padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>❌ 봉사 취소</button>
        <button onClick={()=>{toggleDateActive(dk);setAppTab("calendar");}} style={{background:"#fefce8",border:"1px solid #fde68a",borderRadius:8,color:"#d97706",padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>닫기</button>
        <button onClick={()=>deleteDateFully(dk)} style={{background:"#fee2e2",border:"1px solid #fca5a5",borderRadius:8,color:"#dc2626",padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>삭제</button>
      </div>
    </div>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────────
const S={
  page:{minHeight:"100vh",background:"linear-gradient(160deg,#dbeafe 0%,#eff6ff 50%,#e0f2fe 100%)",color:"#1f2937",fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif"},
  loginWrap:{maxWidth:440,margin:"0 auto",padding:"48px 20px"},
  modeRow:{display:"flex",gap:12,marginBottom:16},
  modeBtn:{flex:1,padding:"20px 12px",border:"2px solid #e5e7eb",borderRadius:16,background:"white",cursor:"pointer",textAlign:"center",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"},
  modeBtnOn:{border:"2px solid #2563eb",background:"#eff6ff",boxShadow:"0 4px 12px rgba(37,99,235,0.15)"},
  loginCard:{background:"white",border:"1.5px solid #bfdbfe",borderRadius:16,padding:24,boxShadow:"0 4px 16px rgba(37,99,235,0.08)"},
  label:{display:"block",fontSize:14,color:"#374151",marginBottom:8,fontWeight:700},
  input:{width:"100%",boxSizing:"border-box",background:"white",border:"1.5px solid #cbd5e1",borderRadius:10,color:"#1f2937",padding:"12px 14px",fontSize:15,outline:"none"},
  loginBtn:{width:"100%",marginTop:16,padding:14,background:"linear-gradient(90deg,#2563eb,#1d4ed8)",border:"none",borderRadius:12,color:"white",fontWeight:900,fontSize:17,cursor:"pointer",boxShadow:"0 4px 16px rgba(37,99,235,0.3)"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16},
  modal:{background:"white",border:"1.5px solid #bfdbfe",borderRadius:20,padding:28,width:"100%",maxWidth:520,boxShadow:"0 8px 40px rgba(37,99,235,0.15)",maxHeight:"90vh",overflowY:"auto"},
  textarea:{width:"100%",boxSizing:"border-box",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,color:"#1f2937",padding:"12px 14px",fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit",lineHeight:1.6,height:180},
  header:{background:"white",borderBottom:"2px solid #bfdbfe",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 8px rgba(37,99,235,0.08)"},
  arrowBtn:{width:40,height:40,borderRadius:10,border:"2px solid #bfdbfe",background:"white",color:"#1e3a8a",fontSize:24,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"},
  primaryBtn:{background:"linear-gradient(90deg,#2563eb,#1d4ed8)",border:"none",borderRadius:10,color:"white",padding:"10px 20px",fontWeight:800,fontSize:14,cursor:"pointer",boxShadow:"0 2px 8px rgba(37,99,235,0.25)"},
  ghostBtn:{background:"white",border:"1.5px solid #cbd5e1",borderRadius:8,color:"#374151",padding:"8px 14px",fontSize:13,cursor:"pointer",fontWeight:600},
  adminPanel:{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:14,padding:16,marginBottom:16},
  aPanelTitle:{fontWeight:700,fontSize:14,color:"#1d4ed8",marginBottom:12},
};
