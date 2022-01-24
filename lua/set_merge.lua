local function tableMerge(t1, t2)
	for k,v in pairs(t2) do
		if type(v) == 'table' then
			if type(t1[k] or false) == 'table' then
				tableMerge(t1[k] or {}, t2[k] or {})
			else
				t1[k] = v
			end
		else
			t1[k] = v
		end
	end
	return t1
end

local value = redis.call('GET', KEYS[1])
if value == 'TOMBSTONE' or value == nil then
	return {nil, ''}
end

local old_session = cjson.decode(tostring(value))
if (old_session.lastModified == tonumber(ARGV[3])) then
	value = ARGV[1]
else
	local new_session = cjson.decode(tostring(value))
	value = cjson.encode(tableMerge(old_session, new_session))
end

return {redis.call('SET', KEYS[1], value, 'PX', ARGV[2]), value}
