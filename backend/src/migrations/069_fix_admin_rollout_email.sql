-- 068_platform_user_access_tiers.sql granted the sole Admin seat to
-- 'aramiah92@gmail.com' — that was the Claude Code session's account email,
-- not Ananda Ramiah's actual platform login (ananda@theoutliergroup.com.au).
-- Correct it: the real login becomes Admin; anything that landed on the
-- wrong address (in a platform-kind org) is demoted back to Basic so there
-- isn't a stray admin seat left behind.
UPDATE users u
   SET role = 'admin'
  FROM organizations o
 WHERE u.organization_id = o.id
   AND o.kind = 'platform'
   AND u.email = 'ananda@theoutliergroup.com.au';

UPDATE users u
   SET role = 'basic'
  FROM organizations o
 WHERE u.organization_id = o.id
   AND o.kind = 'platform'
   AND u.email = 'aramiah92@gmail.com';
