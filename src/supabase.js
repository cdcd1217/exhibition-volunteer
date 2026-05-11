import { createClient } from '@supabase/supabase-js';

// ✅ Supabase 프로젝트 생성 후 아래 두 값을 교체하세요
// Supabase 대시보드 → Settings → API 에서 확인
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
