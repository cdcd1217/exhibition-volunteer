-- ================================================
-- 전시대 봉사 앱 Supabase DB 스키마
-- Supabase 대시보드 → SQL Editor 에서 전체 복사 후 실행
-- ================================================

-- 1. 설정 테이블 (전시대 이름, 전역 설정)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 회원 테이블
CREATE TABLE IF NOT EXISTS members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '',
  gender TEXT DEFAULT '형제' CHECK (gender IN ('형제', '자매')),
  is_admin BOOLEAN DEFAULT FALSE,
  is_leader BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 봉사 날짜 테이블
CREATE TABLE IF NOT EXISTS service_dates (
  date_key TEXT PRIMARY KEY,       -- 'YYYY-MM-DD'
  active BOOLEAN DEFAULT TRUE,
  active_locations JSONB DEFAULT '[true,false,false,false,false]',
  start_time TEXT DEFAULT '09:00',
  total_hours INTEGER DEFAULT 2,
  cancelled BOOLEAN DEFAULT FALSE,
  cancel_reason TEXT DEFAULT '',
  leaders JSONB DEFAULT '{}',      -- {locIdx: memberName}
  schedule_overrides JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 신청 테이블
CREATE TABLE IF NOT EXISTS registrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date_key TEXT NOT NULL REFERENCES service_dates(date_key) ON DELETE CASCADE,
  loc_idx INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date_key, loc_idx, member_name)
);

-- 기본 관리자 계정 삽입
INSERT INTO members (name, gender, is_admin, is_leader)
VALUES ('관리자', '형제', TRUE, TRUE)
ON CONFLICT (name) DO NOTHING;

-- 기본 전시대 이름 설정
INSERT INTO settings (key, value)
VALUES ('location_names', '["A 전시대","B 전시대","C 전시대","D 전시대","E 전시대"]')
ON CONFLICT (key) DO NOTHING;

-- RLS (Row Level Security) - 모든 사용자 읽기/쓰기 허용 (앱 자체 인증 사용)
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_settings" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_members" ON members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_dates" ON service_dates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_registrations" ON registrations FOR ALL USING (true) WITH CHECK (true);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_service_dates_updated_at
  BEFORE UPDATE ON service_dates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
