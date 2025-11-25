-- ============================================================================
-- GHOST-NEXT: Row Level Security Policies for transcripts2
-- ============================================================================
-- NOTE: Service role key bypasses RLS by default
-- Backend uses service_role key for all operations
-- ============================================================================

-- Enable RLS
ALTER TABLE public.transcripts2 ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Policies
-- ============================================================================

-- Drop existing policies if recreating
DROP POLICY IF EXISTS transcripts2_user_select ON public.transcripts2;
DROP POLICY IF EXISTS transcripts2_user_insert ON public.transcripts2;
DROP POLICY IF EXISTS transcripts2_user_update ON public.transcripts2;
DROP POLICY IF EXISTS transcripts2_user_delete ON public.transcripts2;

-- SELECT: Users can only view their own transcripts
CREATE POLICY transcripts2_user_select ON public.transcripts2
  FOR SELECT
  USING (user_id = auth.uid());

-- INSERT: Users can create transcripts for themselves
CREATE POLICY transcripts2_user_insert ON public.transcripts2
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- UPDATE: Users can update their own transcripts
CREATE POLICY transcripts2_user_update ON public.transcripts2
  FOR UPDATE
  USING (user_id = auth.uid());

-- DELETE: Users can delete their own transcripts
CREATE POLICY transcripts2_user_delete ON public.transcripts2
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- Service Role Access
-- ============================================================================
-- By default, service_role key bypasses RLS.
-- The backend server MUST use service_role key.
-- This allows the backend to create records for any user_id.

-- ============================================================================
-- Usage Notes
-- ============================================================================
/*
  Backend (Node/Express):
  - Use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)
  - Can insert records with any user_id

  Client (if any direct access):
  - Use anon key + auth token
  - RLS enforces user_id = auth.uid()

  Verify policies:
  SELECT policyname, tablename, cmd, qual
  FROM pg_policies
  WHERE tablename = 'transcripts2';
*/
