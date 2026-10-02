$deadline = (Get-Date).AddMinutes(30)
while ((Get-Date) -lt $deadline) {
    if (Select-String -Path D:\kimodo\out\swordmaster-pilot.log -Pattern 'PILOT_MOTIONS_DONE' -Quiet) {
        cmd /c "D:\trellis2\glory-pilot-gen.cmd > D:\trellis2\swordmaster-pilot\generate.log 2>&1"
        exit $LASTEXITCODE
    }
    Start-Sleep -Seconds 15
}
'Motion job did not finish; model job was not started.' | Out-File D:\trellis2\swordmaster-pilot\generate.log
exit 1
