local value = redis.call('GET', KEYS[1])
if value == 'TOMBSTONE' or value == nil then
	return nil
end

return redis.call('PEXPIRE', KEYS[1], ARGV[1])
