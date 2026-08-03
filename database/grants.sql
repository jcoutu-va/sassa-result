-- Grant application user access to the skate_results database
GRANT CONNECT ON DATABASE skate_results TO skate_app;
GRANT USAGE ON SCHEMA public TO skate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skate_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO skate_app;
-- Ensure future tables are also covered
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skate_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO skate_app;
