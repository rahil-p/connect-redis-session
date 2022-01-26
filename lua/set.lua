local value = redis.call('GET', KEYS[1])
if value == 'TOMBSTONE' then
	return nil
end

return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
