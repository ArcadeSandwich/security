# Shared read-only helpers for the probe and the fix packs. Dot-source it; it changes nothing.
# Kept by Security · Network (SEC-INFRA-2).

function Test-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Strip anything that looks like a secret from a string: name=value pairs with a secret-like name,
# and long runs of token characters. Names and lengths stay, values go.
function Remove-Secrets([string]$s) {
    if ($null -eq $s) { return $s }
    $s = [regex]::Replace($s, '(?i)\b([\w-]*(key|token|secret|password|passwd|pwd|auth|code|cookie)[\w-]*)(\s*[=:]\s*)("[^"]*"|''[^'']*''|\S+)', { param($m) "$($m.Groups[1].Value)$($m.Groups[3].Value)<hidden>" })
    $s = [regex]::Replace($s, '[A-Za-z0-9_+/=-]{40,}', { param($m) "<hidden len $($m.Value.Length)>" })
    return $s
}

# Walk any object made of hashtables, arrays and plain values and scrub every string.
function Remove-SecretsDeep($o) {
    if ($null -eq $o) { return $null }
    if ($o -is [string]) { return (Remove-Secrets $o) }
    if ($o -is [System.Collections.IDictionary]) {
        $h = [ordered]@{}
        foreach ($k in $o.Keys) { $h[$k] = Remove-SecretsDeep $o[$k] }
        return $h
    }
    if ($o -is [System.Collections.IEnumerable]) { return @($o | ForEach-Object { Remove-SecretsDeep $_ }) }
    if ($o -is [psobject] -and $o.psobject.Properties.Count -gt 0 -and -not ($o -is [ValueType])) {
        $h = [ordered]@{}
        foreach ($p in $o.psobject.Properties) { $h[$p.Name] = Remove-SecretsDeep $p.Value }
        return $h
    }
    return $o
}

# All inbound firewall rules, read with netsh (works without admin rights). Field names are English
# (netsh prints them in English even when rule names are Norwegian).
function Get-InboundRulesNetsh {
    $raw = netsh advfirewall firewall show rule name=all dir=in verbose | Out-String
    foreach ($b in ($raw -split "(\r?\n){2,}")) {
        $h = [ordered]@{}
        foreach ($l in ($b -split "\r?\n")) { if ($l -match '^([^:]+?):\s+(.*)$') { $h[$matches[1].Trim()] = $matches[2].Trim() } }
        if ($h.Count -gt 3 -and $h.Contains('Rule Name')) { [pscustomobject]$h }
    }
}

# Enabled inbound allow rules that open a given local port (exact port in a comma list or range).
function Test-PortInList([string]$list, [int]$port) {
    if (-not $list -or $list -eq 'Any') { return $false }
    foreach ($part in ($list -split ',')) {
        $p = $part.Trim()
        if ($p -match '^(\d+)-(\d+)$') { if ($port -ge [int]$matches[1] -and $port -le [int]$matches[2]) { return $true } }
        elseif ($p -match '^\d+$' -and [int]$p -eq $port) { return $true }
    }
    return $false
}

function Get-OpenRulesForPort([int]$port) {
    Get-InboundRulesNetsh | Where-Object { $_.Enabled -eq 'Yes' -and $_.Action -eq 'Allow' -and (Test-PortInList $_.LocalPort $port) }
}
